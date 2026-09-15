// Seam 1: the Stop hook as the user runs it. Spawn `bash hooks/stop.sh` with a Stop hook JSON on stdin
// whose last_assistant_message embeds fixtures, and assert the systemMessage it prints. Diagrams are
// compared with a snapshot per fixture under test/snapshots; notices with their exact text.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => readFileSync(join(root, 'test', 'fixtures', `${name}.mmd`), 'utf8');
const snapshot = (name) => readFileSync(join(root, 'test', 'snapshots', `${name}.txt`), 'utf8');
const fence = (source) => '```mermaid\n' + source + '```\n';

// Absolute path of the bash in use, so a test may empty PATH without losing bash itself.
const bash =
  process.platform === 'win32'
    ? spawnSync('bash', ['-c', 'cygpath -w "$(command -v bash)"'], { encoding: 'utf8' }).stdout.trim()
    : spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const runStopHook = (reply, env = {}) => {
  const hookInput = JSON.stringify({ session_id: 'test-session', hook_event_name: 'Stop', last_assistant_message: reply });
  const child = spawnSync(bash, [join(root, 'hooks', 'stop.sh')], {
    input: hookInput,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, ...env },
  });
  assert.equal(child.status, 0, `stop.sh exited ${child.status}: ${child.stderr}`);
  return { stdout: child.stdout, stderr: child.stderr, output: child.stdout ? JSON.parse(child.stdout) : {} };
};

describe('rendering a flowchart', () => {
  it('shows the diagram under a header naming the plugin, the position and the type', () => {
    const { output } = runStopHook(`Here it is:\n\n${fence(fixture('flowchart'))}`);
    assert.equal(output.systemMessage, snapshot('flowchart'));
  });

  it('renders two blocks in order, one blank line apart, with no leading newline', () => {
    const reply = `First:\n${fence(fixture('flowchart'))}\nSecond:\n${fence(fixture('flowchart-br-accents'))}`;
    const { output } = runStopHook(reply);
    const expected =
      snapshot('flowchart').replace('diagram 1/1', 'diagram 1/2') +
      '\n\n' +
      snapshot('flowchart-br-accents').replace('diagram 1/1', 'diagram 2/2');
    assert.equal(output.systemMessage, expected);
  });

  it('finds a fence indented inside a list item', () => {
    const indented = fixture('flowchart')
      .split('\n')
      .map((line) => (line ? `   ${line}` : line))
      .join('\n');
    const reply = `1. Step one\n\n   \`\`\`mermaid\n${indented}   \`\`\`\n2. Step two\n`;
    const { output } = runStopHook(reply);
    assert.equal(output.systemMessage, snapshot('flowchart'));
  });

  it('breaks a label at <br/> and keeps accents', () => {
    const { output } = runStopHook(fence(fixture('flowchart-br-accents')));
    assert.equal(output.systemMessage, snapshot('flowchart-br-accents'));
    assert.match(output.systemMessage, /\n[^\n]*sem admin/);
    assert.doesNotMatch(output.systemMessage, /<br/);
  });

  it('draws plain ASCII boxes when MERMAID_FOR_CLAUDE_ASCII=1', () => {
    const { output } = runStopHook(fence(fixture('flowchart')), { MERMAID_FOR_CLAUDE_ASCII: '1' });
    assert.equal(output.systemMessage, snapshot('flowchart.ascii'));
    assert.doesNotMatch(output.systemMessage, /[┌┐└┘│─]/);
  });

  it('hands a hostile payload to the renderer verbatim, nothing evaluated', () => {
    const { output } = runStopHook(fence(fixture('flowchart-hostile')));
    assert.equal(output.systemMessage, snapshot('flowchart-hostile'));
    assert.match(output.systemMessage, /\$\(rm -rf \/\) `id` \$HOME/);
    assert.match(output.systemMessage, /say "quoted" and 'single'/);
    assert.match(output.systemMessage, /C:\\temp\\out\.txt/);
  });
});

describe('a block the renderer rejects', () => {
  it('becomes a one-line notice and the next block still renders', () => {
    const { output } = runStopHook(`${fence('foo TD\n    A --> B\n')}\n${fence(fixture('flowchart'))}`);
    const [first, ...rest] = output.systemMessage.split('\n\n');
    assert.equal(
      first,
      'mermaid-for-claude: could not render diagram 1/2 (foo): Invalid mermaid header: "foo TD". Expected "graph TD", "flowchart LR", "stateDiagram-v2", etc.',
    );
    assert.equal(rest.join('\n\n'), snapshot('flowchart').replace('diagram 1/1', 'diagram 2/2'));
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
      assert.equal(output.systemMessage, snapshot('flowchart'), `DISABLE=${JSON.stringify(value)} should keep rendering`);
    }
  });
});

describe('missing runtime', () => {
  it('prints one notice when node is not on PATH and a diagram block is present', () => {
    const { output } = runStopHook(fence(fixture('flowchart')), { PATH: '', Path: '' });
    assert.equal(
      output.systemMessage,
      'mermaid-for-claude: node not found on PATH, diagram not rendered. Install Node 20+ or set MERMAID_FOR_CLAUDE_DISABLE=1 to silence this.',
    );
  });

  it('prints nothing when node is missing but the reply has no diagram block', () => {
    const { stdout } = runStopHook('No diagram here.', { PATH: '', Path: '' });
    assert.equal(stdout, '');
  });
});
