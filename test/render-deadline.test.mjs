// The render deadline (ADR-0008) driven through the Stop hook seam: a block over 3 s becomes a notice and
// the next block still renders; past 7 s from bundle start the rest become notices without rendering.
// One timing line per reply goes to stderr; stdout carries the JSON and nothing else.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fence, fixture, root, runStopHook, snapshot } from './seams/stop-hook.mjs';

const BLOCK_DEADLINE_REASON = 'rendering took longer than 3 s';
const REPLY_DEADLINE_REASON = 'reply render deadline (7 s) exhausted';
const TIMING_LINE_PREFIX = 'mermaid-for-claude: blocks=';

const noticeFor = (position, reason) => `mermaid-for-claude: could not render diagram ${position} (flowchart): ${reason}`;
const timed = (run) => {
  const startedAt = performance.now();
  const result = run();
  return { ...result, elapsedMs: performance.now() - startedAt };
};
const timingLines = (stderr) => stderr.split('\n').filter((line) => line.startsWith(TIMING_LINE_PREFIX));
// `key=value` pairs before the first `dN=` are the reply summary; each `dN=type ...` group is one block.
const parseTimingLine = (line) => {
  const [summary, ...blocks] = line.slice('mermaid-for-claude: '.length).split(/ (?=d\d+=)/);
  const pairs = (text) => Object.fromEntries([...text.matchAll(/(\S+?)=("[^"]*"|\S+)/g)].map(([, key, value]) => [key, value.replace(/^"|"$/g, '')]));
  return { summary: pairs(summary), blocks: blocks.map(pairs) };
};

describe('a block over the render deadline', () => {
  it('becomes a notice after about 3 s, named by its canonical type, and the next block still renders', () => {
    // The chain spelled `graph TD` behind front matter: the notice must still say `flowchart`.
    const chainAsGraph = `---\ntitle: Pipeline\n---\n${fixture('deadline-chain-30').replace(/^flowchart TD/, 'graph TD')}`;
    assert.match(chainAsGraph, /^---\ntitle: Pipeline\n---\ngraph TD\n/);
    const reply = `${fence(chainAsGraph)}\n${fence(fixture('flowchart'))}`;
    const { output, stderr, elapsedMs } = timed(() => runStopHook(reply));
    const [first, ...rest] = output.systemMessage.split('\n\n');
    assert.equal(first, noticeFor('1/2', BLOCK_DEADLINE_REASON));
    assert.equal(rest.join('\n\n'), snapshot('flowchart').replace('diagram 1/1', 'diagram 2/2'));
    assert.ok(elapsedMs > 3_000 && elapsedMs < 6_000, `expected about 3.5 s, took ${Math.round(elapsedMs)} ms`);
    assert.doesNotMatch(stderr, /Stop hook/);
    const [line] = timingLines(stderr);
    const { blocks } = parseTimingLine(line);
    assert.equal(blocks[0].notice, BLOCK_DEADLINE_REASON);
    assert.equal(blocks[1].notice, undefined);
  });
});

describe('a reply over the reply deadline', () => {
  it('gives the remaining blocks the reply-deadline notice without rendering them, within 8 s', () => {
    const chain = fence(fixture('deadline-chain-30'));
    const reply = `${chain}\n${chain}\n${chain}\n${fence(fixture('flowchart'))}`;
    const { output, stderr, elapsedMs } = timed(() => runStopHook(reply));
    // Block 1 spends its 3 s. Block 2 starts at about 3.2 s, so 7 s leaves more than 3 s: it gets 3 s too.
    // Block 3 starts at about 6.4 s with less than 3 s left: it gets what the reply deadline leaves.
    // Block 4 is never handed to a worker: the reply deadline has passed.
    assert.deepEqual(output.systemMessage.split('\n\n'), [
      noticeFor('1/4', BLOCK_DEADLINE_REASON),
      noticeFor('2/4', BLOCK_DEADLINE_REASON),
      noticeFor('3/4', REPLY_DEADLINE_REASON),
      noticeFor('4/4', REPLY_DEADLINE_REASON),
    ]);
    // The hook's own clock starts at bundle start; the wall clock adds bash and node startup, which a
    // shared CI runner stretches past a second. Claude Code kills the hook at 10 s (hooks.json).
    const { summary } = parseTimingLine(timingLines(stderr)[0]);
    assert.ok(Number(summary.totalMs) < 8_000, `expected under 8 s from bundle start, the hook reported ${summary.totalMs} ms`);
    assert.ok(elapsedMs < 9_500, `expected well under the 10 s hook timeout, took ${Math.round(elapsedMs)} ms`);
  });
});

describe('the timing line', () => {
  it('is the only timing line on stderr, and stdout carries only the JSON', () => {
    const { stdout, stderr } = runStopHook(fence(fixture('flowchart')));
    assert.equal(timingLines(stderr).length, 1);
    assert.equal(stdout, JSON.stringify(JSON.parse(stdout)));
    assert.equal(stdout.trimEnd(), stdout);
  });

  it('reports the reply summary and one group per block, with a small diagram well under a second', () => {
    const { stderr } = runStopHook(fence(fixture('flowchart')), { MERMAID_FOR_CLAUDE_ASCII: '1', MERMAID_FOR_CLAUDE_MAX_WIDTH: '90' });
    const [line] = timingLines(stderr);
    const { summary, blocks } = parseTimingLine(line);
    const body = snapshot('flowchart.ascii').split('\n').slice(1);
    assert.equal(summary.blocks, '1');
    assert.equal(summary.chars, String(snapshot('flowchart.ascii').length));
    assert.equal(summary.terminal, 'none/none');
    assert.equal(summary.widthLimit, '90');
    assert.equal(summary.ascii, 'true');
    assert.ok(Number(summary.totalMs) < 1_000, `expected under 1 s, the hook reported ${summary.totalMs} ms`);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].d1, 'flowchart');
    assert.equal(blocks[0].rows, String(body.length));
    assert.equal(blocks[0].width, String(Math.max(...body.map((row) => row.length))));
    assert.ok(Number(blocks[0].ms) <= Number(summary.totalMs));
    assert.equal(blocks[0].notice, undefined);
  });
});

describe('the worker path', () => {
  it('resolves next to the bundle when the plugin root contains a space', () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), 'mfc plugin root '));
    try {
      cpSync(join(root, 'dist'), join(pluginRoot, 'dist'), { recursive: true });
      cpSync(join(root, 'hooks'), join(pluginRoot, 'hooks'), { recursive: true });
      const { output } = runStopHook(fence(fixture('flowchart')), { CLAUDE_PLUGIN_ROOT: pluginRoot });
      assert.equal(output.systemMessage, snapshot('flowchart'));
    } finally {
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });
});

describe('a worker that fails while a block is pending', () => {
  it('gives that block a notice with the error, tries the next block in a fresh worker, and the hook still answers', () => {
    // A plugin root without the worker bundle: every worker fails at boot, with the block already pending.
    const pluginRoot = mkdtempSync(join(tmpdir(), 'mfc-no-worker-'));
    try {
      cpSync(join(root, 'hooks'), join(pluginRoot, 'hooks'), { recursive: true });
      cpSync(join(root, 'dist', 'hook.mjs'), join(pluginRoot, 'dist', 'hook.mjs'));
      const reply = `${fence(fixture('flowchart'))}\n${fence(fixture('flowchart'))}`;
      const { output, stderr } = runStopHook(reply, { CLAUDE_PLUGIN_ROOT: pluginRoot });
      const [first, second, ...rest] = output.systemMessage.split('\n\n');
      assert.match(first, /^mermaid-for-claude: could not render diagram 1\/2 \(flowchart\): Cannot find module/);
      assert.match(second, /^mermaid-for-claude: could not render diagram 2\/2 \(flowchart\): Cannot find module/);
      assert.deepEqual(rest, []);
      assert.doesNotMatch(stderr, /Stop hook/);
      const { blocks } = parseTimingLine(timingLines(stderr)[0]);
      assert.equal(blocks.length, 2);
      assert.match(blocks[0].notice, /^Cannot find module/);
      assert.match(blocks[1].notice, /^Cannot find module/);
    } finally {
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });
});
