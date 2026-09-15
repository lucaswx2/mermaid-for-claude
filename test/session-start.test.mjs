// Seam 2: the SessionStart hook as the user runs it. Spawn `bash hooks/session-start.sh` with a session
// JSON on stdin and assert the additionalContext it prints. The parity test reads the script as text and
// compares its type list and default width with the values the TypeScript source exports.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { transform } from 'esbuild';
import { bash, root } from './seams/stop-hook.mjs';

const script = join(root, 'hooks', 'session-start.sh');

const runSessionStart = (env = {}) => {
  const sessionInput = JSON.stringify({ session_id: 'test-session', hook_event_name: 'SessionStart', source: 'startup', cwd: root });
  const child = spawnSync(bash, [script], {
    input: sessionInput,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, ...env },
  });
  assert.equal(child.status, 0, `session-start.sh exited ${child.status}: ${child.stderr}`);
  return { stdout: child.stdout, stderr: child.stderr, output: child.stdout ? JSON.parse(child.stdout) : {} };
};

const contextLine = (width) =>
  'mermaid-for-claude is active: ```mermaid blocks in your replies are rendered as text diagrams right below the reply in this terminal. ' +
  'Prefer a mermaid block over hand-drawn ASCII for flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, xychart-beta, pie, gitGraph, mindmap, journey, timeline, kanban, packet, radar, gantt, quadrantChart, block and treemap. ' +
  `Keep each diagram under ${width} columns wide and about 60 rows tall: short labels, few nodes. Wider or longer diagrams are replaced by a notice. ` +
  'erDiagram renders roughly; other mermaid types do not render here. This applies even where a skill says the terminal prints mermaid fences as raw text.';

// Node 20 cannot import TypeScript, so the two source modules are transpiled in memory and imported
// through a data URL: the test compares exported values, not source text.
const importTypeScript = async (relativePath) => {
  const source = readFileSync(join(root, relativePath), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

describe('the context line', () => {
  it('matches the spec wording with the seventeen types in order and the default width of 120', () => {
    const { output, stdout } = runSessionStart({ MERMAID_FOR_CLAUDE_MAX_WIDTH: '' });
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.equal(output.hookSpecificOutput.additionalContext, contextLine(120));
    assert.equal(Object.keys(output).join(), 'hookSpecificOutput');
    assert.equal(stdout, stdout.trim(), 'stdout carries no trailing newline or space');
  });

  it('carries MERMAID_FOR_CLAUDE_MAX_WIDTH when it is a positive integer', () => {
    assert.equal(runSessionStart({ MERMAID_FOR_CLAUDE_MAX_WIDTH: '220' }).output.hookSpecificOutput.additionalContext, contextLine(220));
    assert.equal(runSessionStart({ MERMAID_FOR_CLAUDE_MAX_WIDTH: ' 80 ' }).output.hookSpecificOutput.additionalContext, contextLine(80));
    assert.equal(runSessionStart({ MERMAID_FOR_CLAUDE_MAX_WIDTH: '007' }).output.hookSpecificOutput.additionalContext, contextLine(7));
  });

  it('falls back to 120 when the variable is junk', () => {
    for (const junk of ['abc', '-5', '0', '12px', '1e3', '+5', '3.5', ' ']) {
      const { output } = runSessionStart({ MERMAID_FOR_CLAUDE_MAX_WIDTH: junk });
      assert.equal(output.hookSpecificOutput.additionalContext, contextLine(120), `MAX_WIDTH=${JSON.stringify(junk)} should give 120`);
    }
  });
});

describe('staying silent', () => {
  it('prints nothing and exits 0 when MERMAID_FOR_CLAUDE_DISABLE is truthy', () => {
    for (const value of ['1', 'true', 'yes']) {
      const { stdout } = runSessionStart({ MERMAID_FOR_CLAUDE_DISABLE: value });
      assert.equal(stdout, '', `DISABLE=${JSON.stringify(value)} should print nothing`);
    }
  });

  it('treats an empty, 0 or false MERMAID_FOR_CLAUDE_DISABLE as off', () => {
    for (const value of ['', '0', 'false']) {
      const { output } = runSessionStart({ MERMAID_FOR_CLAUDE_DISABLE: value, MERMAID_FOR_CLAUDE_MAX_WIDTH: '' });
      assert.equal(output.hookSpecificOutput.additionalContext, contextLine(120), `DISABLE=${JSON.stringify(value)} should keep the context line`);
    }
  });

  it('prints nothing and exits 0 when node is not on PATH', () => {
    const { stdout } = runSessionStart({ PATH: '', Path: '' });
    assert.equal(stdout, '');
  });
});

describe('parity with the TypeScript source', () => {
  const scriptText = readFileSync(script, 'utf8');

  it('lists the same recommended types in the same order as RECOMMENDED_TYPES', async () => {
    const { RECOMMENDED_TYPES } = await importTypeScript('src/recommended-types.ts');
    const match = scriptText.match(/^recommended_types='([^']*)'$/m);
    assert.ok(match, "session-start.sh declares recommended_types='...' on its own line");
    assert.deepEqual(match[1].split(', '), RECOMMENDED_TYPES);
    assert.equal(RECOMMENDED_TYPES.length, 17);
  });

  it('uses the same default width as DEFAULT_WIDTH_LIMIT', async () => {
    const { DEFAULT_WIDTH_LIMIT, resolveWidthLimit } = await importTypeScript('src/width-limit.ts');
    const match = scriptText.match(/^default_width=(\d+)$/m);
    assert.ok(match, 'session-start.sh declares default_width=N on its own line');
    assert.equal(Number(match[1]), DEFAULT_WIDTH_LIMIT);
    for (const value of ['220', ' 80 ', '007', 'abc', '-5', '0', '12px', '']) {
      const expected = resolveWidthLimit(value);
      assert.equal(runSessionStart({ MERMAID_FOR_CLAUDE_MAX_WIDTH: value }).output.hookSpecificOutput.additionalContext, contextLine(expected), `MAX_WIDTH=${JSON.stringify(value)} should resolve like the bundle`);
    }
  });
});
