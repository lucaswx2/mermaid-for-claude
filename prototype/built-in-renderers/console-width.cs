// PROTOTYPE - throwaway. Wayfinder ticket #15. Windows helper compiled at session start by console-width.ps1
// (csc.exe from the .NET Framework, present on every Windows 10 and 11): attaches to the console of the given
// process id and exits with its window width as the exit code (0 when there is no window: hidden console,
// no such process, access denied). Exit code instead of stdout because AttachConsole rebinds the standard
// handles. Usage: console-width.exe <pid>
using System;
using System.Runtime.InteropServices;

static class ConsoleWidth
{
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [StructLayout(LayoutKind.Sequential)] struct COORD { public short X; public short Y; }
    [StructLayout(LayoutKind.Sequential)] struct SMALL_RECT { public short Left; public short Top; public short Right; public short Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    struct CSBI { public COORD Size; public COORD Cursor; public ushort Attributes; public SMALL_RECT Window; public COORD MaximumWindowSize; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetConsoleScreenBufferInfo(IntPtr handle, out CSBI info);

    static int Main(string[] args)
    {
        uint pid;
        if (args.Length < 1 || !uint.TryParse(args[0], out pid)) return 0;
        FreeConsole();
        if (!AttachConsole(pid)) return 0;
        if (GetConsoleWindow() == IntPtr.Zero) return 0;
        IntPtr handle = CreateFileW("CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
        CSBI info;
        if (!GetConsoleScreenBufferInfo(handle, out info)) return 0;
        int width = info.Window.Right - info.Window.Left + 1;
        return width > 0 && width < 65536 ? width : 0;
    }
}
