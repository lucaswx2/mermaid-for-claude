// Seam 1: the Stop hook as the user runs it. Spawn `bash hooks/stop.sh` with a Stop hook JSON on stdin
// whose last_assistant_message embeds fixtures, and assert the systemMessage it prints.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => readFileSync(join(root, 'test', 'fixtures', `${name}.mmd`), 'utf8');
const fence = (source) => '```mermaid\n' + source + '```\n';

const runStopHook = (reply, env = {}) => {
  const input = JSON.stringify({ session_id: 'test-session', hook_event_name: 'Stop', last_assistant_message: reply });
  const result = spawnSync('bash', [join(root, 'hooks', 'stop.sh')], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, ...env },
  });
  assert.equal(result.status, 0, `stop.sh exited ${result.status}: ${result.stderr}`);
  return { stdout: result.stdout, stderr: result.stderr, output: result.stdout ? JSON.parse(result.stdout) : {} };
};

describe('rendering a flowchart', () => {
  it('shows the diagram under a header naming the plugin, the position and the type', () => {
    const { output } = runStopHook(`Here it is:\n\n${fence(fixture('flowchart'))}`);
    const lines = output.systemMessage.split('\n');
    assert.equal(lines[0], 'mermaid-for-claude: diagram 1/1 (flowchart)');
    assert.match(output.systemMessage, /┌.*┐/);
    assert.match(output.systemMessage, /Start/);
    assert.match(output.systemMessage, /Done/);
    assert.match(output.systemMessage, /Ok\?/);
  });
});
