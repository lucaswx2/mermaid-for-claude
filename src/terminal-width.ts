// Measuring the terminal on every reply (ADR-0008). A Windows hook process runs on an invisible console
// that always reports 120x30, so the live width comes from the console of an ancestor, read by the helper
// that hooks/session-start.sh compiles from hooks/console-width.cs; elsewhere /dev/tty answers directly.
// When neither answers, the width the SessionStart hook cached for this session does, and past that the
// caller falls back to 120. Nothing here throws, blocks or writes: a failed measurement is `none`.
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteStream } from 'node:tty';
import { logTrace } from './trace.js';
import { positiveInteger } from './width-limit.js';

export type TerminalWidth = { source: 'live' | 'tty' | 'cache'; columns: number } | { source: 'none' };

// A console that answers takes about 160 ms on Windows; a second is already a broken machine.
const HELPER_TIMEOUT_MS = 1_000;
const CACHE_FOLDER = 'mermaid-for-claude';
const CONSOLE_WIDTH_HELPER = 'console-width.exe';
// Test seam (test/seams/stop-hook.mjs): no automated test has a console, so this stands in for the
// platform measurement. A positive integer is the width it reports; anything else answers nothing.
const FAKE_TERMINAL_WIDTH = 'MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH';

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

// Never under the plugin root (spec #16): the Claude configuration directory when it exists, else the OS
// temp directory. hooks/session-start.sh derives the same path in bash and writes the cache file there.
const cacheDirectory = () => {
  const configDir = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude');
  return isDirectory(configDir) ? join(configDir, CACHE_FOLDER) : join(tmpdir(), CACHE_FOLDER);
};

const cacheFileFor = (sessionId: string) => {
  const name = sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'unknown';
  return join(cacheDirectory(), `terminal-${name}`);
};

// `<columns> <console pid>` as the SessionStart hook measured them; the pid is 0 off Windows. No cache
// file is the ordinary first-reply case, not a failure.
const readCachedMeasurement = (sessionId: string) => {
  const nothingCached = { columns: undefined, consolePid: undefined };
  const cacheFile = cacheFileFor(sessionId);
  if (!isFile(cacheFile)) return nothingCached;
  try {
    const [columns = '', consolePid = ''] = readFileSync(cacheFile, 'utf8').trim().split(/\s+/);
    return { columns: positiveInteger(columns), consolePid: positiveInteger(consolePid) };
  } catch (err) {
    logTrace(`could not read the cached terminal width from ${cacheFile}`, err);
    return nothingCached;
  }
};

// The helper prints `<columns> <console pid>` and exits 0, or prints nothing and exits 1. The pid the
// SessionStart hook cached saves it the ancestry walk, which needs every process in the chain alive.
const consoleColumns = (consolePid: number | undefined) => {
  const helper = join(cacheDirectory(), CONSOLE_WIDTH_HELPER);
  if (!isFile(helper)) return undefined;
  try {
    const answer = spawnSync(helper, consolePid === undefined ? [] : [String(consolePid)], {
      encoding: 'utf8',
      timeout: HELPER_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    if (answer.status !== 0) return undefined;
    return positiveInteger(answer.stdout?.split(/\s+/)[0]);
  } catch (err) {
    logTrace('the console width helper could not be run', err);
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

// Opening /dev/tty never blocks: with no controlling terminal it fails at once. Read-write first,
// because that is what a tty stream wants, then read-only for a terminal that allows nothing else.
const ttyColumns = () => {
  for (const flags of ['r+', 'r']) {
    let fd: number | undefined;
    let stream: WriteStream | undefined;
    try {
      fd = openSync('/dev/tty', flags);
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

const platformColumns = (consolePid: number | undefined) => {
  const fake = process.env[FAKE_TERMINAL_WIDTH];
  if (fake !== undefined) return positiveInteger(fake);
  return process.platform === 'win32' ? consoleColumns(consolePid) : ttyColumns();
};

export const measureTerminalWidth = (sessionId: string): TerminalWidth => {
  const cached = readCachedMeasurement(sessionId);
  const columns = platformColumns(cached.consolePid);
  if (columns !== undefined) return { source: process.platform === 'win32' ? 'live' : 'tty', columns };
  if (cached.columns !== undefined) return { source: 'cache', columns: cached.columns };
  return { source: 'none' };
};
