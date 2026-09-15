// Seam 1: the Stop hook as the user runs it. Spawn `bash hooks/stop.sh` with a Stop hook JSON on stdin
// whose last_assistant_message embeds fixtures, and hand back the systemMessage it prints. Every test
// file drives the hook through this module; none imports a renderer or the dispatcher directly.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixture = (name) => readFileSync(join(root, 'test', 'fixtures', `${name}.mmd`), 'utf8');
export const snapshot = (name) => readFileSync(join(root, 'test', 'snapshots', `${name}.txt`), 'utf8');
export const fence = (source) => '```mermaid\n' + source + '```\n';

// Absolute path of the bash in use, so a test may empty PATH without losing bash itself.
export const bash =
  process.platform === 'win32'
    ? spawnSync('bash', ['-c', 'cygpath -w "$(command -v bash)"'], { encoding: 'utf8' }).stdout.trim()
    : spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

// A key set to `undefined` in `env` removes that variable from the child's environment, so a test can
// assert a fallback even when the developer's shell exports the variable.
const childEnv = (env) =>
  Object.fromEntries(Object.entries({ ...process.env, CLAUDE_PLUGIN_ROOT: root, ...env }).filter(([, value]) => value !== undefined));

export const runStopHook = (reply, env = {}) => {
  const hookInput = JSON.stringify({ session_id: 'test-session', hook_event_name: 'Stop', last_assistant_message: reply });
  const child = spawnSync(bash, [join(root, 'hooks', 'stop.sh')], {
    input: hookInput,
    encoding: 'utf8',
    env: childEnv(env),
  });
  assert.equal(child.status, 0, `stop.sh exited ${child.status}: ${child.stderr}`);
  return { stdout: child.stdout, stderr: child.stderr, output: child.stdout ? JSON.parse(child.stdout) : {} };
};
