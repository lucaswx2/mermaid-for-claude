// Windows console width helper (ADR-0008). A hook process runs on its own invisible console, which
// always reports 120x30; the console the user resizes belongs to an ancestor of the hook. Attaching to
// that ancestor and reading its screen buffer gives the live width.
//
//   console-width.exe [pid]   prints "<columns> <pid>" and exits 0, or prints nothing and exits 1.
//
// With a pid it attaches to that process's console, which is what the Stop hook does on every reply with
// the pid cached at session start; without one, or when that pid no longer has a console with a window,
// it walks the process ancestry with one Toolhelp32 snapshot and takes the first ancestor whose console
// has a window. The printed pid is the one that answered, so the caller can cache it.
//
// hooks/session-start.sh compiles this once per machine with the .NET Framework csc.exe into the cache
// directory outside the plugin root; the binary never ships.
//
// The original stdout handle is captured before attaching and written to directly: AttachConsole may
// rebind the standard handles of the calling process, and the width must never land in the user's
// terminal. Plain C# 5 syntax only, so the .NET Framework compiler on a stock Windows accepts it.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

static class ConsoleWidth
{
    const int MaxDepth = 12;
    const uint SnapshotProcesses = 0x00000002;
    const uint GenericRead = 0x80000000;
    const uint GenericWrite = 0x40000000;
    const uint ShareReadWrite = 0x00000003;
    const uint OpenExisting = 3;
    const int StdOutputHandle = -11;

    [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetConsoleScreenBufferInfo(IntPtr handle, out BufferInfo info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool WriteFile(IntPtr handle, byte[] buffer, uint count, out uint written, IntPtr overlapped);

    [StructLayout(LayoutKind.Sequential)] struct Coord { public short X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct SmallRect { public short Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct BufferInfo
    {
        public Coord Size;
        public Coord Cursor;
        public ushort Attributes;
        public SmallRect Window;
        public Coord MaximumWindowSize;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry
    {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public IntPtr HeapId;
        public uint ModuleId;
        public uint Threads;
        public uint ParentProcessId;
        public int PriorityClassBase;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExeFile;
    }

    static Dictionary<uint, uint> ParentsByProcessId()
    {
        Dictionary<uint, uint> parents = new Dictionary<uint, uint>();
        IntPtr snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        if (snapshot == IntPtr.Zero || snapshot.ToInt64() == -1) return parents;
        ProcessEntry entry = new ProcessEntry();
        entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
        if (Process32FirstW(snapshot, ref entry))
        {
            do { parents[entry.ProcessId] = entry.ParentProcessId; } while (Process32NextW(snapshot, ref entry));
        }
        CloseHandle(snapshot);
        return parents;
    }

    // The visible width of the console this process is attached to, or 0 when the console has no window
    // (the invisible console every hook process gets) or its screen buffer cannot be read.
    static int WidthOfAttachedConsole()
    {
        if (GetConsoleWindow() == IntPtr.Zero) return 0;
        IntPtr conout = CreateFileW("CONOUT$", GenericRead | GenericWrite, ShareReadWrite, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
        if (conout.ToInt64() == -1) return 0;
        BufferInfo info;
        bool read = GetConsoleScreenBufferInfo(conout, out info);
        CloseHandle(conout);
        if (!read) return 0;
        int width = info.Window.Right - info.Window.Left + 1;
        return width > 0 ? width : 0;
    }

    static int WidthOfConsoleOf(uint processId)
    {
        FreeConsole();
        return AttachConsole(processId) ? WidthOfAttachedConsole() : 0;
    }

    static int Main(string[] args)
    {
        IntPtr stdout = GetStdHandle(StdOutputHandle);

        uint console = 0;
        int width = 0;
        if (args.Length > 0 && uint.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out console) && console != 0)
        {
            width = WidthOfConsoleOf(console);
        }

        // No pid, or the cached one lost its console: walk up from here. Only works while every process
        // in the chain is alive, which is why the pid found here is cached for later replies.
        if (width == 0)
        {
            Dictionary<uint, uint> parents = ParentsByProcessId();
            console = GetCurrentProcessId();
            for (int depth = 0; depth < MaxDepth && width == 0; depth++)
            {
                uint parent;
                if (!parents.TryGetValue(console, out parent) || parent == 0) break;
                console = parent;
                width = WidthOfConsoleOf(console);
            }
        }

        FreeConsole();
        if (width == 0) return 1;

        string answer = width.ToString(CultureInfo.InvariantCulture) + " " + console.ToString(CultureInfo.InvariantCulture);
        byte[] bytes = Encoding.ASCII.GetBytes(answer);
        uint written;
        WriteFile(stdout, bytes, (uint)bytes.Length, out written, IntPtr.Zero);
        return 0;
    }
}
