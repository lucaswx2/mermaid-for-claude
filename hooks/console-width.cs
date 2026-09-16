// Windows console width probe (ADR-0008). A hook process runs on its own invisible console, which always
// reports 120x30; the console the user resizes belongs to an ancestor of the hook. Attaching to that
// ancestor and reading its screen buffer gives the live width.
//
//   console-width.exe                    prints "<columns> <pid> <creation time>" and exits 0,
//   console-width.exe <pid> <creation>   or prints nothing and exits 1.
//   console-width.exe --self-test        prints "ok" and exits 0, touching no console at all.
//
// With a pid it attaches to that process's console, which is what the Stop hook does on every reply with
// what hooks/session-start.sh cached. The creation time goes with the pid because Windows recycles pids:
// a pid whose process started at another time is a stranger, and attaching to its console would report
// someone else's window as this terminal. Without a pid, or when the pair does not match, or when that
// console has no window any more, it walks the process ancestry with one Toolhelp32 snapshot and takes
// the first ancestor whose console has a window. The walk needs every process in the chain alive, which
// is why the pair that answered is printed for the SessionStart hook to cache. The Stop hook only reads
// the columns: nothing but hooks/session-start.sh writes the cache file.
//
// hooks/session-start.sh compiles this once per machine with the .NET Framework csc.exe into the cache
// directory outside the plugin root, and runs --self-test once on what came out before trusting it; the
// binary never ships.
//
// The original stdout handle is captured before attaching and written to directly: AttachConsole may
// rebind the standard handles of the calling process, and the width must never land in the user's
// terminal. Plain C# 5 syntax only, so the .NET Framework compiler on a stock Windows accepts it.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class ConsoleWidth
{
    const int MaxDepth = 12;
    // Its own deadline, because no caller can give it one: a `timeout` in front of this process would
    // join the very ancestry the walk reads. Generous next to the 54-78 ms it takes when all is well.
    const int DeadlineMs = 2000;
    const uint SnapshotProcesses = 0x00000002;
    const uint GenericRead = 0x80000000;
    const uint GenericWrite = 0x40000000;
    const uint ShareReadWrite = 0x00000003;
    const uint OpenExisting = 3;
    const int StdOutputHandle = -11;
    const uint QueryLimitedInformation = 0x1000;

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
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);

    [StructLayout(LayoutKind.Sequential)] struct Coord { public short X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct SmallRect { public short Left, Top, Right, Bottom; }

    // BufferInfo and its `info` are CONSOLE_SCREEN_BUFFER_INFO and keep the Win32 name they mirror.
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

    // When a process started, which together with its pid identifies it: Windows hands a pid out again
    // once its process is gone. 0 when the process cannot be opened, which never matches a cached time.
    static long CreationTimeOf(uint processId)
    {
        IntPtr process = OpenProcess(QueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero) return 0;
        long creation, exited, kernel, user;
        bool read = GetProcessTimes(process, out creation, out exited, out kernel, out user);
        CloseHandle(process);
        return read ? creation : 0;
    }

    static void WriteAnswer(IntPtr stdout, string answer)
    {
        byte[] bytes = Encoding.ASCII.GetBytes(answer);
        uint written;
        WriteFile(stdout, bytes, (uint)bytes.Length, out written, IntPtr.Zero);
    }

    // Nothing here should ever wait, but a wedged console host could keep a Win32 call from returning,
    // and a session start must not wait on this. A background thread ends the process instead.
    static void StartDeadline()
    {
        Thread deadline = new Thread(delegate()
        {
            Thread.Sleep(DeadlineMs);
            Environment.Exit(2);
        });
        deadline.IsBackground = true;
        deadline.Start();
    }

    static int Main(string[] args)
    {
        IntPtr stdout = GetStdHandle(StdOutputHandle);

        // Proves to hooks/session-start.sh that what csc.exe produced runs on this machine.
        if (args.Length > 0 && args[0] == "--self-test")
        {
            WriteAnswer(stdout, "ok");
            return 0;
        }

        StartDeadline();

        uint console = 0;
        long creation = 0;
        int width = 0;
        if (args.Length > 1 &&
            uint.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out console) && console != 0 &&
            long.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out creation) && creation != 0 &&
            CreationTimeOf(console) == creation)
        {
            width = WidthOfConsoleOf(console);
        }

        // No pair, a pid that is now a different process, or a console that lost its window: walk up from
        // here. Only works while every process in the chain is alive, which is why the pair that answers
        // is printed for the SessionStart hook to cache.
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
            creation = width == 0 ? 0 : CreationTimeOf(console);
        }

        FreeConsole();
        if (width == 0) return 1;

        WriteAnswer(
            stdout,
            width.ToString(CultureInfo.InvariantCulture) + " " + console.ToString(CultureInfo.InvariantCulture) + " " + creation.ToString(CultureInfo.InvariantCulture));
        return 0;
    }
}
