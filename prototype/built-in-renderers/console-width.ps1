# PROTOTYPE - throwaway. Wayfinder ticket #15. Prints the column count of the console Claude Code draws on
# and, when -SessionId is given, writes it to <CacheDir>/<SessionId>.width for the Stop hook to read.
# Hook processes get an invisible default console (120x30) on Windows, so CONOUT$ lies to them; the console
# of the claude.exe ancestor is the ConPTY one Windows Terminal resizes. FreeConsole + AttachConsole(pid),
# then GetConsoleScreenBufferInfo on a fresh CONOUT$ handle. Prints nothing when no ancestor console answers.
param([string]$SessionId = '', [string]$CacheDir = '', [uint32]$ClaudePid = 0, [string]$CompileTo = '')

# The Stop hook cannot afford PowerShell (about 1 s) on every reply, and a background process dies with the
# hook (job object), so the width it needs live comes from console-width.exe, a 5 KB helper compiled here
# once from console-width.cs with the csc.exe every Windows ships in the .NET Framework (about 0.8 s).
if ($CompileTo) {
  $source = Join-Path $PSScriptRoot 'console-width.cs'
  $stale = -not (Test-Path $CompileTo) -or (Get-Item $CompileTo).LastWriteTimeUtc -lt (Get-Item $source).LastWriteTimeUtc
  if ($stale) {
    $csc = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
    if (Test-Path $csc) {
      New-Item -ItemType Directory -Force -Path (Split-Path $CompileTo) | Out-Null
      & $csc /nologo /optimize+ /target:exe "/out:$CompileTo" $source 2>&1 | Out-Null
    }
  }
}

$sig = @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
[StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
[StructLayout(LayoutKind.Sequential)] public struct SMALL_RECT { public short Left; public short Top; public short Right; public short Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct CSBI { public COORD dwSize; public COORD dwCursorPosition; public ushort wAttributes; public SMALL_RECT srWindow; public COORD dwMaximumWindowSize; }
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CSBI info);
'@
Add-Type -MemberDefinition $sig -Name Console -Namespace MermaidForClaude

# The ancestry walk only works while every process between this one and claude.exe is alive (WMI keeps no
# record of exited processes), so it runs at SessionStart, synchronously, and stores the pid it found; the
# Stop hook's background run passes that pid back with -ClaudePid and skips the walk.
# Attaches to a process's console and returns its window width, or $null. Consoles created for hidden
# processes (CREATE_NO_WINDOW: hooks, helpers) have no window handle; the ConPTY console of the Claude Code
# process does, so the handle tells the real terminal apart from a hidden 120x30 default.
function Get-ConsoleWidth([uint32]$ProcessId) {
  [void][MermaidForClaude.Console]::FreeConsole()
  if (-not [MermaidForClaude.Console]::AttachConsole($ProcessId)) { return $null }
  if ([MermaidForClaude.Console]::GetConsoleWindow() -eq [IntPtr]::Zero) { return $null }
  $h = [MermaidForClaude.Console]::CreateFileW("CONOUT`$", [uint32]3221225472, [uint32]3, [IntPtr]::Zero, [uint32]3, [uint32]0, [IntPtr]::Zero)
  $info = New-Object MermaidForClaude.Console+CSBI
  if (-not [MermaidForClaude.Console]::GetConsoleScreenBufferInfo($h, [ref]$info)) { return $null }
  return $info.srWindow.Right - $info.srWindow.Left + 1
}

$width = $null
$target = $ClaudePid
if ($target) { $width = Get-ConsoleWidth $target }
if ($null -eq $width) {
  # Walk the ancestors (one WMI query for every process, about 0.3 s) and take the first one whose console
  # has a window: Claude Code itself, whatever its binary is called. Stops where the chain is broken.
  $byPid = @{}
  foreach ($p in Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name) { $byPid[[int]$p.ProcessId] = $p }
  $pid0 = [uint32]$PID
  for ($depth = 0; $depth -lt 12; $depth++) {
    $proc = $byPid[[int]$pid0]
    if (-not $proc) { if ($env:MERMAID_FOR_CLAUDE_PROBE_DEBUG) { [Console]::Error.WriteLine("hop $depth pid=$pid0 not found") }; break }
    if ($depth -gt 0) {
      $width = Get-ConsoleWidth $pid0
      if ($env:MERMAID_FOR_CLAUDE_PROBE_DEBUG) { [Console]::Error.WriteLine("hop $depth pid=$pid0 $($proc.Name) width=$width") }
      if ($null -ne $width) { $target = $pid0; break }
    }
    if ($proc.Name -imatch '^(explorer|WindowsTerminal|OpenConsole)\.exe$') { break }
    $pid0 = [uint32]$proc.ParentProcessId
  }
}
if ($null -eq $width) { exit 0 }

Write-Output $width
if ($SessionId -and $CacheDir) {
  $safe = $SessionId -replace '[^A-Za-z0-9_-]', ''
  if ($safe) {
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
    foreach ($entry in @(@{ ext = 'width'; value = $width }, @{ ext = 'pid'; value = $target })) {
      $file = Join-Path $CacheDir "$safe.$($entry.ext)"
      $tmp = "$file.$PID.tmp"
      [IO.File]::WriteAllText($tmp, "$($entry.value)")
      Move-Item -Force $tmp $file
    }
  }
}
