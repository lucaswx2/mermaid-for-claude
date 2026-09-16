// The two hooks as the user runs them. Spawn `bash hooks/stop.sh` with a Stop hook JSON on stdin whose
// last_assistant_message embeds fixtures, or `bash hooks/session-start.sh` with a session JSON, and hand
// back what they print. Every test file drives the hooks through this module; none imports a renderer or
// the dispatcher directly.
//
// Two things are fixed for every child (ADR-0008). CLAUDE_CONFIG_DIR points at a scratch directory, so no
// test reads or writes the developer's own terminal-width cache. MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH
// is `0`, which stands in for the platform measurement answering nothing: no automated test has a
// console, and a developer running the tests inside a real terminal must see the widths CI sees. A test
// that wants a terminal passes a positive integer for it; a test that wants the cache writes the cache
// file with `cacheTerminalWidth`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixture = (name) => readFileSync(join(root, 'test', 'fixtures', `${name}.mmd`), 'utf8');
export const snapshot = (name) => readFileSync(join(root, 'test', 'snapshots', `${name}.txt`), 'utf8');
export const fence = (source) => '```mermaid\n' + source + '```\n';

const SESSION_ID = 'test-session';
export const configDir = mkdtempSync(join(tmpdir(), 'mermaid-for-claude-test-'));
export const cacheDir = join(configDir, 'mermaid-for-claude');
export const cacheFileFor = (sessionId = SESSION_ID) => join(cacheDir, `terminal-${sessionId}`);
process.on('exit', () => {
  // A throw in an exit handler would fail the whole file; a leftover scratch directory would not.
  try {
    rmSync(configDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {}
});

// What hooks/session-start.sh writes after measuring: `<columns> <console pid>`.
export const cacheTerminalWidth = (columns, consolePid = 0) => {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFileFor(), `${columns} ${consolePid}\n`);
};

// Absolute path of the bash in use, so a test may empty PATH without losing bash itself.
export const bash =
  process.platform === 'win32'
    ? spawnSync('bash', ['-c', 'cygpath -w "$(command -v bash)"'], { encoding: 'utf8' }).stdout.trim()
    : spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

// A key set to `undefined` in `env` removes that variable from the child's environment, so a test can
// assert a fallback even when the developer's shell exports the variable.
const childEnv = (env) =>
  Object.fromEntries(
    Object.entries({
      ...process.env,
      CLAUDE_PLUGIN_ROOT: root,
      CLAUDE_CONFIG_DIR: configDir,
      MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '0',
      ...env,
    }).filter(([, value]) => value !== undefined),
  );

const runHook = (script, hookInput, env) => {
  const child = spawnSync(bash, [join(root, 'hooks', script)], { input: hookInput, encoding: 'utf8', env: childEnv(env) });
  assert.equal(child.status, 0, `${script} exited ${child.status}: ${child.stderr}`);
  return { stdout: child.stdout, stderr: child.stderr, output: child.stdout ? JSON.parse(child.stdout) : {} };
};

export const runStopHook = (reply, env = {}) =>
  runHook('stop.sh', JSON.stringify({ session_id: SESSION_ID, hook_event_name: 'Stop', last_assistant_message: reply }), env);

export const runSessionStart = (env = {}, session = {}) =>
  runHook('session-start.sh', JSON.stringify({ session_id: SESSION_ID, hook_event_name: 'SessionStart', source: 'startup', cwd: root, ...session }), env);
