// The four first built-in renderers (ticket #23, ADR-0004, ADR-0006) driven through the Stop hook seam:
// pie, mindmap, journey and timeline render their fixture as the snapshot, swap every glyph under
// MERMAID_FOR_CLAUDE_ASCII=1, fit MERMAID_FOR_CLAUDE_MAX_WIDTH=60, and give the `unsupported line`
// notice for a line outside their grammar subset. Snapshots are compared at a fixed width of 120.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fence, fixture, runStopHook, snapshot } from './seams/stop-hook.mjs';

const WIDE = { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120', MERMAID_FOR_CLAUDE_ASCII: undefined };
const ASCII = { ...WIDE, MERMAID_FOR_CLAUDE_ASCII: '1' };
const NARROW = { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '60' };

const notice = (type, reason) => `mermaid-for-claude: could not render diagram 1/1 (${type}): ${reason}`;
const widestRow = (text) => Math.max(...text.split('\n').map((row) => [...row].length));
const ANSI_ESCAPE = /\x1b\[/;
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const RENDERED = ['pie', 'mindmap', 'journey', 'timeline'];

describe('rendering the four fixtures', () => {
  for (const name of RENDERED) {
    it(`renders the ${name} fixture under its canonical header`, () => {
      const { output } = runStopHook(fence(fixture(name)), WIDE);
      assert.equal(output.systemMessage, snapshot(name));
      assert.match(output.systemMessage, new RegExp(`^mermaid-for-claude: diagram 1/1 \\(${name}\\)\n`));
      assert.doesNotMatch(output.systemMessage, ANSI_ESCAPE);
      assert.doesNotMatch(output.systemMessage, EMOJI);
    });
  }

  it('strips mindmap shapes to their text, breaks a label at <br/> and ignores ::icon and :::class', () => {
    const { output } = runStopHook(fence(fixture('mindmap-shapes')), WIDE);
    assert.equal(output.systemMessage, snapshot('mindmap-shapes'));
    const body = output.systemMessage.split('\n').slice(1).join('\n');
    assert.doesNotMatch(body, /icon|urgent|<br|[()[\]{}]/);
  });

  it('renders a pie preceded by a one-line init directive', () => {
    const { output } = runStopHook(fence(fixture('pie-init-directive')), WIDE);
    assert.equal(output.systemMessage, snapshot('pie-init-directive'));
  });

  it('shows the value beside the percentage only with showData', () => {
    const withData = runStopHook(fence(fixture('pie')), WIDE).output.systemMessage;
    const withoutData = runStopHook(fence(fixture('pie').replace('pie showData', 'pie')), WIDE).output.systemMessage;
    assert.match(withData, /94\.5% \(1480\)/);
    assert.match(withoutData, /94\.5%$/m);
    assert.doesNotMatch(withoutData, /\(1480\)/);
  });
});

describe('MERMAID_FOR_CLAUDE_ASCII=1', () => {
  for (const name of RENDERED) {
    it(`draws the ${name} fixture with ASCII glyphs only`, () => {
      const { output } = runStopHook(fence(fixture(name)), ASCII);
      assert.equal(output.systemMessage, snapshot(`${name}.ascii`));
      assert.match(output.systemMessage, /^[\x20-\x7e\n]*$/, 'every character is printable ASCII');
    });
  }

  it('cuts a journey task name with an ASCII ellipsis under a narrow limit', () => {
    const { output } = runStopHook(fence(fixture('journey')), { ...ASCII, MERMAID_FOR_CLAUDE_MAX_WIDTH: '60' });
    assert.match(output.systemMessage, /Raw fence shown above the dia\.\.\. {2}\*\*ooo/);
    assert.ok(widestRow(output.systemMessage) <= 60);
  });
});

describe('a line outside the grammar subset', () => {
  it('gives the unsupported line notice for the pie-bad-line fixture and no partial diagram', () => {
    const { output } = runStopHook(fence(fixture('pie-bad-line')), WIDE);
    assert.equal(output.systemMessage, notice('pie', 'unsupported line: Cats : 30'));
  });

  it('gives the unsupported line notice for a journey task without a score', () => {
    const { output } = runStopHook(fence('journey\n    title Trip\n    section Go\n      Pack the bags\n'), WIDE);
    assert.equal(output.systemMessage, notice('journey', 'unsupported line: Pack the bags'));
  });

  it('gives the unsupported line notice for a timeline continuation before any period', () => {
    const { output } = runStopHook(fence('timeline\n    title Trip\n    : Pack the bags\n'), WIDE);
    assert.equal(output.systemMessage, notice('timeline', 'unsupported line: : Pack the bags'));
  });

  it('gives the unsupported line notice for a mindmap with a second root', () => {
    const { output } = runStopHook(fence('mindmap\n  root((One))\n    child\n  other((Two))\n'), WIDE);
    assert.equal(output.systemMessage, notice('mindmap', 'unsupported line: other((Two))'));
  });

  it('gives the unsupported line notice for a pie header with extra text', () => {
    const { output } = runStopHook(fence('pie chart\n    "Dogs" : 40\n'), WIDE);
    assert.equal(output.systemMessage, notice('pie', 'unsupported line: pie chart'));
  });

  it('cuts a long unsupported line in the notice', () => {
    const line = `Cats ${'x'.repeat(80)}`;
    const { output } = runStopHook(fence(`pie title Pets\n    ${line}\n`), WIDE);
    assert.equal(output.systemMessage, notice('pie', `unsupported line: ${line.slice(0, 39)}…`));
  });
});

describe('MERMAID_FOR_CLAUDE_MAX_WIDTH=60', () => {
  for (const name of RENDERED) {
    it(`fits the ${name} fixture inside 60 columns`, () => {
      const { output } = runStopHook(fence(fixture(name)), NARROW);
      assert.match(output.systemMessage, /^mermaid-for-claude: diagram 1\/1/);
      assert.ok(widestRow(output.systemMessage) <= 60, `widest row is ${widestRow(output.systemMessage)}`);
    });
  }

  it('shortens the pie bars to fit', () => {
    const { output } = runStopHook(fence(fixture('pie')), NARROW);
    assert.equal(output.systemMessage, snapshot('pie.narrow'));
  });

  it('cuts journey task names with … to fit', () => {
    const { output } = runStopHook(fence(fixture('journey')), NARROW);
    assert.equal(output.systemMessage, snapshot('journey.narrow'));
    assert.match(output.systemMessage, /Raw fence shown above the diagr…/);
  });

  it('wraps long mindmap labels under their node', () => {
    const { output } = runStopHook(fence(fixture('mindmap')), NARROW);
    assert.equal(output.systemMessage, snapshot('mindmap.narrow'));
  });

  it('keeps the timeline unchanged when it already fits', () => {
    const { output } = runStopHook(fence(fixture('timeline')), NARROW);
    assert.equal(output.systemMessage, snapshot('timeline'));
  });
});
