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

// Absolute path of the bash in use, so a test may shrink PATH without losing bash itself.
const bash =
  process.platform === 'win32'
    ? spawnSync('bash', ['-c', 'cygpath -w "$(command -v bash)"'], { encoding: 'utf8' }).stdout.trim()
    : spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const runStopHook = (reply, env = {}) => {
  const input = JSON.stringify({ session_id: 'test-session', hook_event_name: 'Stop', last_assistant_message: reply });
  const result = spawnSync(bash, [join(root, 'hooks', 'stop.sh')], {
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

  it('renders two blocks in order, one blank line apart, with no leading newline', () => {
    const reply = `First:\n${fence(fixture('flowchart'))}\nSecond:\n${fence(fixture('flowchart-br-accents'))}`;
    const { output } = runStopHook(reply);
    assert.ok(output.systemMessage.startsWith('mermaid-for-claude: diagram 1/2 (flowchart)\n'));
    assert.match(output.systemMessage, /\S\n\nmermaid-for-claude: diagram 2\/2 \(flowchart\)\n/);
    assert.equal(output.systemMessage.split('mermaid-for-claude: diagram ').length, 3);
  });

  it('finds a fence indented inside a list item', () => {
    const indented = fixture('flowchart')
      .split('\n')
      .map((line) => (line ? `   ${line}` : line))
      .join('\n');
    const reply = `1. Step one\n\n   \`\`\`mermaid\n${indented}   \`\`\`\n2. Step two\n`;
    const { output } = runStopHook(reply);
    assert.equal(output.systemMessage.split('\n')[0], 'mermaid-for-claude: diagram 1/1 (flowchart)');
    assert.match(output.systemMessage, /Start/);
  });

  it('breaks a label at <br/> and keeps accents', () => {
    const { output } = runStopHook(fence(fixture('flowchart-br-accents')));
    assert.match(output.systemMessage, /18-ajustes-usuario\.ps1/);
    assert.match(output.systemMessage, /\n[^\n]*sem admin/);
    assert.doesNotMatch(output.systemMessage, /<br/);
    assert.match(output.systemMessage, /Reiniciar · pronto/);
  });

  it('draws plain ASCII boxes when MERMAID_FOR_CLAUDE_ASCII=1', () => {
    const { output } = runStopHook(fence(fixture('flowchart')), { MERMAID_FOR_CLAUDE_ASCII: '1' });
    assert.match(output.systemMessage, /\+-+\+/);
    assert.doesNotMatch(output.systemMessage, /[┌┐└┘│─]/);
  });

  it('hands a hostile payload to the renderer verbatim, nothing evaluated', () => {
    const { output } = runStopHook(fence(fixture('flowchart-hostile')));
    assert.match(output.systemMessage, /\$\(rm -rf \/\)/);
    assert.match(output.systemMessage, /`id`/);
    assert.match(output.systemMessage, /\$HOME/);
    assert.match(output.systemMessage, /"quoted"/);
    assert.match(output.systemMessage, /'single'/);
  });
});

describe('a block the renderer rejects', () => {
  it('becomes a one-line notice and the next block still renders', () => {
    const { output } = runStopHook(`${fence('foo TD\n    A --> B\n')}\n${fence(fixture('flowchart'))}`);
    const [first, second] = output.systemMessage.split('\n\n');
    assert.match(first, /^mermaid-for-claude: could not render diagram 1\/2 \(foo\): \S/);
    assert.equal(first.split('\n').length, 1);
    assert.ok(second.startsWith('mermaid-for-claude: diagram 2/2 (flowchart)\n'));
  });
});

describe('staying silent', () => {
  it('prints nothing for a reply without a diagram block', () => {
    const { stdout } = runStopHook('Just prose, and a ```js\nconsole.log(1)\n``` block.');
    assert.equal(stdout, '');
  });

  it('prints nothing when MERMAID_FOR_CLAUDE_DISABLE=1', () => {
    const { stdout } = runStopHook(fence(fixture('flowchart')), { MERMAID_FOR_CLAUDE_DISABLE: '1' });
    assert.equal(stdout, '');
  });

  it('treats an empty, 0 or false MERMAID_FOR_CLAUDE_DISABLE as off', () => {
    for (const value of ['', '0', 'false']) {
      const { output } = runStopHook(fence(fixture('flowchart')), { MERMAID_FOR_CLAUDE_DISABLE: value });
      assert.match(output.systemMessage ?? '', /diagram 1\/1/, `DISABLE=${JSON.stringify(value)} should keep rendering`);
    }
  });
});

describe('missing runtime', () => {
  it('prints one notice when node is not on PATH and a diagram block is present', () => {
    // PATH reduced to the directory holding `cat` (needed by the wrapper), which never holds node.
    const catDir = dirname(spawnSync('bash', ['-c', 'command -v cat'], { encoding: 'utf8' }).stdout.trim());
    const { output } = runStopHook(fence(fixture('flowchart')), { PATH: catDir, Path: catDir });
    assert.equal(
      output.systemMessage,
      'mermaid-for-claude: node not found on PATH, diagram not rendered. Install Node 20+ or set MERMAID_FOR_CLAUDE_DISABLE=1 to silence this.',
    );
  });
});
