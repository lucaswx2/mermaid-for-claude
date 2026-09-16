// The four remaining S-tier built-in renderers (ticket #24, ADR-0006) driven through the Stop hook seam:
// gitGraph, kanban, packet and radar render their fixture as the snapshot, swap every glyph under
// MERMAID_FOR_CLAUDE_ASCII=1, fit MERMAID_FOR_CLAUDE_MAX_WIDTH=60, give a notice when fitting is
// impossible, and give the `unsupported line` notice for a line outside their grammar subset.
// Snapshots are compared at a fixed width of 120.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fence, fixture, runStopHook, snapshot } from './seams/stop-hook.mjs';

const WIDE = { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120', MERMAID_FOR_CLAUDE_ASCII: undefined };
const ASCII = { ...WIDE, MERMAID_FOR_CLAUDE_ASCII: '1' };
const NARROW = { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '60' };

const notice = (type, reason) => `mermaid-for-claude: could not render diagram 1/1 (${type}): ${reason}`;
const widestRow = (text) => Math.max(...text.split('\n').map((row) => [...row].length));
const bodyOf = (systemMessage) => systemMessage.split('\n').slice(1).join('\n');
const ANSI_ESCAPE = /\x1b\[/;
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const RENDERED = [
  ['gitgraph', 'gitGraph'],
  ['gitgraph-plain', 'gitGraph'],
  ['kanban', 'kanban'],
  ['packet', 'packet'],
  ['packet-relative', 'packet'],
  ['radar', 'radar'],
];

describe('rendering the fixtures', () => {
  for (const [name, type] of RENDERED) {
    it(`renders the ${name} fixture under its canonical header`, () => {
      const { output } = runStopHook(fence(fixture(name)), WIDE);
      assert.equal(output.systemMessage, snapshot(name));
      assert.match(output.systemMessage, new RegExp(`^mermaid-for-claude: diagram 1/1 \\(${type}\\)\n`));
      assert.doesNotMatch(output.systemMessage, ANSI_ESCAPE);
      assert.doesNotMatch(output.systemMessage, EMOJI);
    });
  }
});

describe('gitGraph', () => {
  it('prints ids, tags, merge and branch names on the right and one commit glyph per row', () => {
    const body = bodyOf(runStopHook(fence(fixture('gitgraph')), WIDE).output.systemMessage);
    assert.match(body, /^●\s+adr-0001 \[v0\.1\]$/m);
    assert.match(body, /^├─┐\s+branch prototype\/end-to-end$/m);
    assert.match(body, /^◆─┘\s+merge prototype\/end-to-end merge e2e \[v0\.2\]$/m);
    assert.match(body, /^◉\s+adr-0003$/m);
    assert.equal(body.split('\n').filter((row) => /[●◆◉⊗]/.test(row)).length, 9, 'one row per commit');
  });

  it('accepts and ignores the direction, prints no auto id and draws REVERSE and cherry-pick', () => {
    const body = bodyOf(runStopHook(fence(fixture('gitgraph-plain')), WIDE).output.systemMessage);
    assert.doesNotMatch(body, /LR/);
    assert.match(body, /^●$/m, 'a commit without an id has no label');
    assert.match(body, /^│ {3}⊗$/m);
    assert.match(body, /^● {3}│ {2}cherry-pick abc123$/m);
    assert.match(body, /^◆───┘ {2}merge hotfix \[v1\.0\.1\]$/m);
  });

  it('closes a lane after its last merge and keeps a later lane apart', () => {
    const rows = bodyOf(runStopHook(fence(fixture('gitgraph')), WIDE).output.systemMessage).split('\n');
    const mergeRow = rows.findIndex((row) => row.includes('merge e2e'));
    assert.equal(rows[mergeRow + 1]?.slice(0, 5), '├───┐', 'the next fork skips the closed lane column');
    assert.equal(rows[mergeRow + 2]?.slice(0, 5), '│   ●');
    assert.match(rows[mergeRow + 3] ?? '', /^◉\s+adr-0003$/, 'the closed lane leaves no vertical behind');
  });

  it('gives a notice for a merge of a branch without commits', () => {
    const { output } = runStopHook(fence('gitGraph\n    commit\n    branch dev\n    checkout main\n    merge dev\n'), WIDE);
    assert.equal(output.systemMessage, notice('gitGraph', 'branch dev has no commits to merge'));
  });

  it('gives the unsupported line notice for a reset line', () => {
    const { output } = runStopHook(fence('gitGraph\n    commit\n    reset main\n'), WIDE);
    assert.equal(output.systemMessage, notice('gitGraph', 'unsupported line: reset main'));
  });

  it('gives the unsupported line notice for a commit option outside the subset', () => {
    const { output } = runStopHook(fence('gitGraph\n    commit id: "a" msg: "hello"\n'), WIDE);
    assert.equal(output.systemMessage, notice('gitGraph', 'unsupported line: commit id: "a" msg: "hello"'));
  });

  it('gives the unsupported line notice for a header with an unknown direction', () => {
    const { output } = runStopHook(fence('gitGraph RL:\n    commit\n'), WIDE);
    assert.equal(output.systemMessage, notice('gitGraph', 'unsupported line: gitGraph RL:'));
  });
});

describe('kanban', () => {
  it('draws boxed columns side by side with the metadata under the item', () => {
    const body = bodyOf(runStopHook(fence(fixture('kanban')), WIDE).output.systemMessage);
    assert.match(body, /^│ Todo {25}│ In progress {18}│ Done {25}│$/m);
    assert.match(body, /^│ Size policy prototype {8}│/m);
    assert.match(body, /^│ {3}#15 High {19}│/m);
    assert.match(body, /│ {3}#13 lucaswx2 High {10}│/);
  });

  it('gives a notice for the ten-column fixture at 120', () => {
    const { output } = runStopHook(fence(fixture('kanban-wide')), WIDE);
    assert.equal(output.systemMessage, notice('kanban', '10 columns do not fit in 120 columns'));
  });

  it('ignores metadata keys outside ticket, assigned and priority', () => {
    const source = 'kanban\n  Todo\n    [Write docs]@{ ticket: 4, colour: "red", assigned: "ana", weight: 3 }\n';
    const body = bodyOf(runStopHook(fence(source), WIDE).output.systemMessage);
    assert.match(body, /│ Write docs +│/);
    assert.match(body, /│ {3}#4 ana +│/);
    assert.doesNotMatch(body, /red|weight|colour/);
  });

  it('gives the unsupported line notice for an empty label', () => {
    const { output } = runStopHook(fence('kanban\n  Todo\n    []\n'), WIDE);
    assert.equal(output.systemMessage, notice('kanban', 'unsupported line: []'));
  });
});

describe('packet', () => {
  it('draws the TCP header the way RFC 793 prints it', () => {
    const body = bodyOf(runStopHook(fence(fixture('packet')), WIDE).output.systemMessage);
    assert.match(body, /^ 0 {19}1 {19}2 {19}3$/m, 'the tens ruler');
    assert.match(body, /^ 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1$/m, 'the units ruler');
    assert.match(body, /^│ {10}Source Port {10}│ {7}Destination Port {8}│$/m);
    assert.match(body, /^├───────┬───────────┬─┬─┬─┬─┬─┬─┬───────────────────────────────┤$/m);
    assert.match(body, /^│ Data {2}│ {11}│U│A│P│R│S│F│ {31}│$/m, 'tiny cells stack letters vertically');
    assert.match(body, /^│Offset │ Reserved {2}│R│C│S│S│Y│I│ {12}Window {13}│$/m);
    assert.match(body, /^├───────────────────────────────────────────────────────────────┤\n│ {29}Data {30}│\n│ {63}│\n│ {63}│\n└/m, 'a two-row field is one tall cell');
  });

  it('accepts the relative +n form and closes a short last row on the right', () => {
    const body = bodyOf(runStopHook(fence(fixture('packet-relative')), WIDE).output.systemMessage);
    assert.match(body, /^│ {4}Version {4}│ {5}Flags {5}│ {10}Block count {10}│$/m);
    assert.match(body, /^├───────────────┬───────────────────────────────────────────────┘$/m);
    assert.match(body, /^│ {6}CRC {6}│\n└───────────────┘$/m);
  });

  it('gives a notice for a gap between fields', () => {
    const { output } = runStopHook(fence(fixture('packet-gap')), WIDE);
    assert.equal(output.systemMessage, notice('packet', 'bit 16 does not follow bit 7'));
  });

  it('gives a notice for overlapping fields', () => {
    const { output } = runStopHook(fence(fixture('packet-overlap')), WIDE);
    assert.equal(output.systemMessage, notice('packet', 'bit 4 does not follow bit 7'));
  });

  it('gives a notice for a first field that does not start at bit 0', () => {
    const { output } = runStopHook(fence('packet\n8-15: "Late"\n'), WIDE);
    assert.equal(output.systemMessage, notice('packet', 'bit 8 does not follow bit -1'));
  });

  it('gives the unsupported line notice for a field without quotes', () => {
    const { output } = runStopHook(fence('packet\n0-7: Version\n'), WIDE);
    assert.equal(output.systemMessage, notice('packet', 'unsupported line: 0-7: Version'));
  });

  it('drops to 8 bits per row at 17 columns and gives a notice at 16', () => {
    const at17 = runStopHook(fence(fixture('packet')), { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '17' }).output.systemMessage;
    assert.match(at17, /^ 0 1 2 3 4 5 6 7$/m);
    assert.equal(widestRow(bodyOf(at17)), 17);
    const at16 = runStopHook(fence(fixture('packet')), { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '16' }).output.systemMessage;
    assert.equal(at16, notice('packet', 'needs more than 16 columns'));
  });
});

describe('radar', () => {
  it('draws one bar column per curve, honours min and max and prints the scale footer', () => {
    const body = bodyOf(runStopHook(fence(fixture('radar')), WIDE).output.systemMessage);
    assert.match(body, /^ {17}baseline {20}built-in {20}notice only$/m);
    assert.match(body, /^Keeps the point {2}████████████████████████ 5 {2}██████████████░░░░░░░░░░ 3 {2}░░░░░░░░░░░░░░░░░░░░░░░░ 0$/m);
    assert.match(body, /^ {17}scale 0 to 5$/m);
    assert.doesNotMatch(body, /showLegend|graticule/);
  });

  it('derives max from the data when the diagram sets none', () => {
    const source = 'radar\n  axis a["Alpha"], b["Beta"]\n  curve x["one"]{2, 8}\n';
    const body = bodyOf(runStopHook(fence(source), WIDE).output.systemMessage);
    assert.match(body, /^Beta {3}████████████████████████ 8$/m);
    assert.match(body, /^Alpha {2}██████░░░░░░░░░░░░░░░░░░ 2$/m);
    assert.match(body, /scale 0 to 8$/m);
  });

  it('reads the { axisId: value } form in any order', () => {
    const source = 'radar\n  axis a["Alpha"], b["Beta"]\n  curve x["one"]{ b: 1, a: 4 }\n  max 4\n';
    const body = bodyOf(runStopHook(fence(source), WIDE).output.systemMessage);
    assert.match(body, /^Alpha {2}████████████████████████ 4$/m);
    assert.match(body, /^Beta {3}██████░░░░░░░░░░░░░░░░░░ 1$/m);
  });

  it('gives a notice for a curve with the wrong number of values', () => {
    const { output } = runStopHook(fence('radar\n  axis a, b\n  curve x{1}\n'), WIDE);
    assert.equal(output.systemMessage, notice('radar', 'curve x needs 2 numeric values'));
  });

  it('gives the unsupported line notice for a polygon line', () => {
    const { output } = runStopHook(fence('radar\n  axis a, b\n  curve x{1, 2}\n  polygon x\n'), WIDE);
    assert.equal(output.systemMessage, notice('radar', 'unsupported line: polygon x'));
  });
});

describe('MERMAID_FOR_CLAUDE_ASCII=1', () => {
  for (const [name] of RENDERED) {
    it(`draws the ${name} fixture with ASCII glyphs only`, () => {
      const { output } = runStopHook(fence(fixture(name)), ASCII);
      assert.equal(output.systemMessage, snapshot(`${name}.ascii`));
      assert.match(output.systemMessage, /^[\x20-\x7e\n]*$/, 'every character is printable ASCII');
    });
  }

  it('swaps the gitGraph lane junctions and every commit glyph', () => {
    const body = bodyOf(runStopHook(fence(fixture('gitgraph-plain')), ASCII).output.systemMessage);
    assert.match(body, /^\+-\+ {4}branch develop$/m);
    assert.match(body, /^M-\+ {4}merge develop$/m);
    assert.match(body, /^\| {3}x$/m);
    assert.match(body, /^o {3}\| {2}cherry-pick abc123$/m);
  });
});

describe('MERMAID_FOR_CLAUDE_MAX_WIDTH=60', () => {
  for (const [name] of RENDERED) {
    it(`fits the ${name} fixture inside 60 columns`, () => {
      const { output } = runStopHook(fence(fixture(name)), NARROW);
      assert.match(output.systemMessage, /^mermaid-for-claude: diagram 1\/1/);
      assert.ok(widestRow(output.systemMessage) <= 60, `widest row is ${widestRow(output.systemMessage)}`);
    });
  }

  it('drops the packet to 16 bits per row and keeps a two-row field as one tall cell', () => {
    const { output } = runStopHook(fence(fixture('packet')), NARROW);
    assert.equal(output.systemMessage, snapshot('packet.narrow'));
    assert.match(output.systemMessage, /^ 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5$/m);
    assert.match(output.systemMessage, /^│ {8}Sequence Number {8}│\n│ {31}│\n│ {31}│\n├/m);
  });

  it('narrows the kanban columns to 18 and wraps the labels', () => {
    const { output } = runStopHook(fence(fixture('kanban')), NARROW);
    assert.equal(output.systemMessage, snapshot('kanban.narrow'));
    assert.match(output.systemMessage, /^┌──────────────────┬──────────────────┬──────────────────┐$/m);
    assert.match(output.systemMessage, /^│ Prototype M tier │ Prototype S tier │ Channel spike {4}│$/m);
  });

  it('shrinks the radar bars without cutting an axis label', () => {
    const { output } = runStopHook(fence(fixture('radar')), NARROW);
    assert.equal(output.systemMessage, snapshot('radar.narrow'));
    assert.match(output.systemMessage, /^Keeps the point {2}██████████ 5 {2}██████░░░░ 3 {2}░░░░░░░░░░ 0$/m);
  });

  it('keeps the gitGraph unchanged when it already fits', () => {
    const { output } = runStopHook(fence(fixture('gitgraph')), NARROW);
    assert.equal(output.systemMessage, snapshot('gitgraph'));
  });
});
