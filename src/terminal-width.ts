// Measuring the terminal on every reply (ADR-0008). A Windows hook process runs on an invisible console
// that always reports 120x30, so the live width comes from the console of an ancestor, read by the probe
// that hooks/session-start.sh compiles from hooks/console-width.cs; elsewhere /dev/tty answers directly.
// When neither answers, the width the SessionStart hook cached for this session does, and past that the
// caller falls back to 120. Nothing here throws or writes: a failed measurement is `none`.
import { spawnSync } from 'node:child_process';
import { closeSync, constants, openSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WriteStream } from 'node:tty';
import { logTrace } from './trace.js';
import { positiveInteger } from './width-limit.js';

export type TerminalWidth = { source: 'live' | 'tty' | 'cache' | 'fake'; columns: number } | { source: 'none' };

// The probe answers in 54-78 ms on an idle Windows machine and 265 ms at the 90th percentile under load,
// so 400 ms covers a slow answer with margin. It is also the most the measurement may take out of the
// 7 s reply deadline, which runs from bundle start: past it the cached width is the better trade.
const PROBE_TIMEOUT_MS = 400;
const CACHE_FOLDER = 'mermaid-for-claude';
const CONSOLE_WIDTH_PROBE = 'console-width.exe';

// The one test seam in the production path, and the whole rule for it. No automated test has a console,
// so MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH stands in for the platform measurement: a positive integer
// is the width it reports, anything else answers nothing. It is honoured only beside the marker
// MERMAID_FOR_CLAUDE_TEST_SEAM, which only test/seams/stop-hook.mjs sets, so the variable left over in a
// shell profile cannot change what a real session renders; and it answers under its own source name, so
// the timing line can never present it as a measurement. hooks/session-start.sh reads the same pair.
const FAKE_TERMINAL_WIDTH = 'MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH';
const TEST_SEAM = 'MERMAID_FOR_CLAUDE_TEST_SEAM';

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

// Never under the plugin root (spec #16) and never the OS temp directory, which is world-writable and no
// place for a compiled binary: CLAUDE_CONFIG_DIR, else `.claude` under the home directory.
// hooks/session-start.sh derives the same path in bash, and a seam test drives both with it unset.
const cacheDirectory = () => join(process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude'), CACHE_FOLDER);

const cacheFileFor = (sessionId: string) => {
  const name = sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'unknown';
  return join(cacheDirectory(), `terminal-${name}`);
};

// `<columns> <console pid> <creation time>` as the SessionStart hook measured them; the pid and its
// creation time are 0 off Windows. No cache file is the ordinary first-reply case, not a failure.
const readCachedMeasurement = (sessionId: string) => {
  const nothingCached = { columns: undefined, console: [] as string[] };
  const cacheFile = cacheFileFor(sessionId);
  if (!isFile(cacheFile)) return nothingCached;
  try {
    const [columns = '', consolePid = '', startedAt = ''] = readFileSync(cacheFile, 'utf8').trim().split(/\s+/);
    const console = positiveInteger(consolePid) && positiveInteger(startedAt) ? [consolePid, startedAt] : [];
    return { columns: positiveInteger(columns), console };
  } catch (err) {
    logTrace(`could not read the cached terminal width from ${cacheFile}`, err);
    return nothingCached;
  }
};

// The probe prints `<columns> <console pid> <creation time>` and exits 0, or prints nothing and exits 1.
// The pid and creation time the SessionStart hook cached save it the ancestry walk, which needs every
// process in the chain alive; only that hook writes the cache, so nothing is written back here.
const consoleColumns = (console: string[]) => {
  const probe = join(cacheDirectory(), CONSOLE_WIDTH_PROBE);
  if (!isFile(probe)) return undefined;
  try {
    const answer = spawnSync(probe, console, {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    if (answer.status !== 0) return undefined;
    return positiveInteger(answer.stdout?.split(/\s+/)[0]);
  } catch (err) {
    logTrace('the console width probe could not be run', err);
    return undefined;
  }
};

const closeQuietly = (fd: number | undefined, stream: WriteStream | undefined) => {
  try {
    if (stream) stream.destroy();
    else if (fd !== undefined) closeSync(fd);
  } catch (err) {
    logTrace('could not close /dev/tty', err);
  }
};

// O_NONBLOCK so that a terminal which would wait for carrier on open cannot hold up the reply; the
// window size is readable either way. Read-write first, because that is what a tty stream wants, then
// read-only for a terminal that allows nothing else.
const ttyColumns = () => {
  for (const access of [constants.O_RDWR, constants.O_RDONLY]) {
    let fd: number | undefined;
    let stream: WriteStream | undefined;
    try {
      fd = openSync('/dev/tty', access | constants.O_NONBLOCK);
      stream = new WriteStream(fd);
      if (stream.columns > 0) return stream.columns;
    } catch {
      // No controlling terminal, or it does not open that way. The next flag, then `none`.
    } finally {
      closeQuietly(fd, stream);
    }
  }
  return undefined;
};

// `undefined` when the seam is not in play at all, so the platform is asked instead; a seam that is in
// play answers for the platform, whether or not it names a width.
const fakedColumns = () => {
  if (!process.env[TEST_SEAM]) return undefined;
  const fake = process.env[FAKE_TERMINAL_WIDTH];
  return fake === undefined ? undefined : { columns: positiveInteger(fake) };
};

// The platform rung of the ladder, naming which of the three answered. It stands alone: the cache
// below it still answers when this one does not, faked or not.
const platformColumns = (console: string[]): TerminalWidth | undefined => {
  const faked = fakedColumns();
  if (faked) return faked.columns === undefined ? undefined : { source: 'fake', columns: faked.columns };
  if (process.platform === 'win32') {
    const columns = consoleColumns(console);
    return columns === undefined ? undefined : { source: 'live', columns };
  }
  const columns = ttyColumns();
  return columns === undefined ? undefined : { source: 'tty', columns };
};

export const measureTerminalWidth = (sessionId: string): TerminalWidth => {
  const cached = readCachedMeasurement(sessionId);
  const platform = platformColumns(cached.console);
  if (platform) return platform;
  if (cached.columns !== undefined) return { source: 'cache', columns: cached.columns };
  return { source: 'none' };
};
