// The live terminal width (ADR-0008, ticket #22) driven through both hook seams: the width limit follows
// the terminal minus the `Stop says:` indent, a resize is picked up by the next reply, the override still
// wins, and the ladder below the live measurement is the width cached at session start, then 120. No
// automated test has a console, so MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH stands in for the platform
// measurement in every case but one, which drops the fake and asserts only that measuring for real costs
// the reply nothing. What a console or a tty actually answers is verified by hand and kept in ADR-0008.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { cacheDir, cacheFileFor, cacheTerminalWidth, configDir, fence, fixture, root, runSessionStart, runStopHook, snapshot } from './seams/stop-hook.mjs';

// The name the timing line gives the platform measurement: the Windows console helper, or /dev/tty.
const LIVE_SOURCE = process.platform === 'win32' ? 'live' : 'tty';
const WIDE_DIAGRAM_COLUMNS = 208;

const noticeFor = (limit) => `mermaid-for-claude: could not render diagram 1/1 (sequenceDiagram): ${WIDE_DIAGRAM_COLUMNS} columns wide, limit is ${limit}`;
const terminalField = (stderr) => stderr.match(/ terminal=(\S+)/)?.[1];
const widthLimitField = (stderr) => stderr.match(/ widthLimit=(\d+)/)?.[1];
const wideReply = () => fence(fixture('size-sequence-wide'));

beforeEach(() => rmSync(cacheFileFor(), { force: true }));

describe('the width limit on a reply', () => {
  it('is the measured terminal width minus the four columns of the Stop says: indent', () => {
    const { output, stderr } = runStopHook(wideReply(), { MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188' });
    assert.equal(output.systemMessage, noticeFor(184));
    assert.equal(terminalField(stderr), `188/${LIVE_SOURCE}`);
    assert.equal(widthLimitField(stderr), '184');
  });

  it('follows a resize on the very next reply', () => {
    assert.equal(runStopHook(wideReply(), { MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188' }).output.systemMessage, noticeFor(184));
    assert.equal(runStopHook(wideReply(), { MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '80' }).output.systemMessage, noticeFor(76));
    assert.equal(runStopHook(wideReply(), { MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '212' }).output.systemMessage, snapshot('size-sequence-wide'));
  });

  it('lets MERMAID_FOR_CLAUDE_MAX_WIDTH win over the terminal, measuring nothing', () => {
    const { output, stderr } = runStopHook(wideReply(), { MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188', MERMAID_FOR_CLAUDE_MAX_WIDTH: '120' });
    assert.equal(output.systemMessage, noticeFor(120));
    assert.equal(terminalField(stderr), 'none/none', 'the override wins, so nothing is measured');
    assert.equal(widthLimitField(stderr), '120');
  });

  it('falls back to the width the SessionStart hook cached when nothing answers', () => {
    cacheTerminalWidth(100);
    const { output, stderr } = runStopHook(wideReply());
    assert.equal(output.systemMessage, noticeFor(96));
    assert.equal(terminalField(stderr), '100/cache');
  });

  it('prefers the live measurement over the cached one', () => {
    cacheTerminalWidth(100);
    const { output, stderr } = runStopHook(wideReply(), { MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188' });
    assert.equal(output.systemMessage, noticeFor(184));
    assert.equal(terminalField(stderr), `188/${LIVE_SOURCE}`);
  });

  it('falls back to 120 when nothing answers and nothing is cached', () => {
    assert.equal(process.stdout.isTTY, undefined, 'this test must run without a tty (node --test pipes stdout)');
    const { output, stderr } = runStopHook(wideReply(), { MERMAID_FOR_CLAUDE_MAX_WIDTH: undefined });
    assert.equal(output.systemMessage, noticeFor(120));
    assert.equal(terminalField(stderr), 'none/none');
  });

  it('falls back to 120 when the cache file holds junk or a width of zero', () => {
    for (const cached of ['abc', '0', '-5', '', '   ', '1.5']) {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cacheFileFor(), cached);
      const { output } = runStopHook(wideReply());
      assert.equal(output.systemMessage, noticeFor(120), `a cache file holding ${JSON.stringify(cached)} should give 120`);
    }
  });

  // The one case that drops the fake and lets the platform answer for itself. What it answers depends on
  // the machine — nothing under CI, a real width in a developer's terminal — so it asserts the shape
  // instead of a number: a reply that survives, one timing line and no trace, whatever /dev/tty or the
  // console helper does. It is what CI on ubuntu and macos has to say about the /dev/tty path.
  it('measures the platform for real without throwing, hanging or adding a line to the reply', () => {
    const { output, stderr } = runStopHook(wideReply(), { MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: undefined });
    assert.match(terminalField(stderr), /^(none\/none|[1-9]\d*\/(live|tty|cache))$/);
    assert.equal(stderr.trim().split('\n').length, 1, `nothing but the timing line belongs on stderr: ${stderr}`);
    const limit = Number(widthLimitField(stderr));
    assert.ok(limit > 0, `the width limit should be a positive number, got ${limit}`);
    assert.equal(output.systemMessage, limit >= WIDE_DIAGRAM_COLUMNS ? snapshot('size-sequence-wide') : noticeFor(limit));
  });

  it('renders a diagram that fits the measured terminal', () => {
    const { output } = runStopHook(fence(fixture('size-small')), { MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188' });
    assert.equal(output.systemMessage, snapshot('size-small'));
  });
});

describe('the measurement at session start', () => {
  it('caches the width and the console pid outside the plugin root, keyed by the session id', () => {
    runSessionStart({ MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188' });
    const cacheFile = cacheFileFor();
    assert.ok(cacheFile.startsWith(configDir), `${cacheFile} must sit under the Claude configuration directory`);
    assert.ok(!cacheFile.startsWith(root), `${cacheFile} must not sit under the plugin root`);
    assert.equal(readFileSync(cacheFile, 'utf8').trim(), '188 0');
  });

  it('hands the width it measured to the Stop hook when the next reply measures nothing', () => {
    runSessionStart({ MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188' });
    const { output, stderr } = runStopHook(wideReply());
    assert.equal(output.systemMessage, noticeFor(184));
    assert.equal(terminalField(stderr), '188/cache');
  });

  it('carries the measured width minus the indent in the context line of every start kind', () => {
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      const { output } = runSessionStart({ MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188' }, { source });
      assert.match(output.hookSpecificOutput.additionalContext, /Keep each diagram under 184 columns wide/, `source=${source}`);
    }
  });

  it('measures nothing and caches nothing when MERMAID_FOR_CLAUDE_MAX_WIDTH is set', () => {
    const { output } = runSessionStart({ MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188', MERMAID_FOR_CLAUDE_MAX_WIDTH: '220' });
    assert.match(output.hookSpecificOutput.additionalContext, /Keep each diagram under 220 columns wide/);
    assert.ok(!existsSync(cacheFileFor()), 'the override wins, so nothing is measured or cached');
  });

  it('writes nothing under the plugin root', () => {
    const listing = () => [root, join(root, 'hooks'), join(root, 'dist'), join(root, 'src')].map((dir) => readdirSync(dir).join());
    const before = listing();
    runSessionStart({ MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188' });
    runStopHook(wideReply(), { MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH: '188' });
    assert.deepEqual(listing(), before);
  });
});
