// The last three built-in renderers (ticket #26, ADR-0007) driven through the Stop hook seam: quadrantChart,
// block and treemap render their fixtures as the snapshots, swap every glyph under MERMAID_FOR_CLAUDE_ASCII=1,
// fit MERMAID_FOR_CLAUDE_MAX_WIDTH=60, and give the `unsupported line` notice for a line outside their grammar
// subset. Snapshots are compared at a fixed width of 120.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fence, fixture, runStopHook, snapshot } from './seams/stop-hook.mjs';

const WIDE = { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120', MERMAID_FOR_CLAUDE_ASCII: undefined };
const ASCII = { ...WIDE, MERMAID_FOR_CLAUDE_ASCII: '1' };
const NARROW = { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '60' };

const notice = (type, reason) => `mermaid-for-claude: could not render diagram 1/1 (${type}): ${reason}`;
const widestRow = (text) => Math.max(...text.split('\n').map((row) => [...row].length));
const bodyOf = (text) => text.split('\n').slice(1).join('\n');
const ANSI_ESCAPE = /\x1b\[/;
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const FIXTURES = {
  quadrantChart: ['quadrant', 'quadrant-styled'],
  block: ['block', 'block-auto', 'block-edges', 'block-hook', 'block-nested', 'block-process'],
  treemap: ['treemap', 'treemap-classes', 'treemap-flat'],
};
const ALL = Object.entries(FIXTURES).flatMap(([type, names]) => names.map((name) => [type, name]));

describe('rendering the eleven fixtures as in ADR-0007', () => {
  for (const [type, name] of ALL) {
    it(`renders the ${name} fixture under the ${type} name`, () => {
      const { output } = runStopHook(fence(fixture(name)), WIDE);
      assert.equal(output.systemMessage, snapshot(name));
      assert.match(output.systemMessage, new RegExp(`^mermaid-for-claude: diagram 1/1 \\(${type}\\)\n`));
      assert.doesNotMatch(output.systemMessage, ANSI_ESCAPE);
      assert.doesNotMatch(output.systemMessage, EMOJI);
    });
  }
});

describe('quadrantChart', () => {
  it('puts the label to the right of the dot when there is room, else to the left', () => {
    const { output } = runStopHook(fence(fixture('quadrant')), WIDE);
    assert.match(output.systemMessage, /● Campaign C/);
    assert.match(output.systemMessage, /● Campaign A│/, 'a label that ends at the divider still fits on the right');
    assert.match(output.systemMessage, /Campaign F ●/, 'a label that would cross the divider moves to the left of its dot');
  });

  it('centres the label one row below or above when two neighbours contest the same row', () => {
    const source = 'quadrantChart\n    Left: [0.30, 0.70]\n    Right: [0.32, 0.70]\n    Above: [0.31, 0.72]\n';
    const { output } = runStopHook(fence(source), WIDE);
    const rows = bodyOf(output.systemMessage).split('\n');
    const contested = rows.findIndex((row) => row.includes('●●'));
    assert.match(rows[contested], /^│ {19}●●Left {6}│/, 'the two dots share the row; the label on the right belongs to the first');
    assert.match(rows[contested + 1], /^│ {18}Right {8}│/, 'the second label is centred one row below its dot');
    assert.match(rows[contested - 1], /^│ {19}● Above {5}│/, 'the third point sits one row above');
    assert.doesNotMatch(bodyOf(output.systemMessage), /\d/, 'no point fell back to a number');
  });

  it('numbers a point whose cell is already covered by a label instead of writing over it', () => {
    const source = 'quadrantChart\n    First: [0.20, 0.70]\n    Second: [0.40, 0.70]\n    Third: [0.30, 0.70]\n';
    const { output } = runStopHook(fence(source), WIDE);
    const rows = bodyOf(output.systemMessage).split('\n');
    const dots = rows.findIndex((row) => row.includes('● First'));
    assert.match(rows[dots], /^│ {12}● First● Third {5}│/);
    assert.match(rows[dots - 1], /^│ {25}1 {5}│/, 'the number sits on the nearest open cell');
    assert.match(output.systemMessage, /\n\n1 Second$/);
  });

  it('turns a point with no room into a number with a legend and never overwrites a label', () => {
    const { output } = runStopHook(fence(fixture('quadrant-styled')), WIDE);
    assert.equal(output.systemMessage, snapshot('quadrant-styled'));
    const body = bodyOf(output.systemMessage);
    assert.match(body, /●     1      │/, 'Sixel images shares the row with mermaid.parse plus DOM as a number');
    assert.match(body, /\n\n1 Sixel images$/);
    for (const label of ['beautiful-mermaid', 'Built-in S tier', 'Built-in M tier', 'mermaid.parse plus DOM', 'Notice only', 'Kroki', 'Crowded A', 'Crowded B']) {
      assert.match(body, new RegExp(label.replace(/[.]/g, '\\.')), `${label} is intact`);
    }
  });

  it('ignores styling after a point, :::class on a point and classDef lines', () => {
    const { output } = runStopHook(fence(fixture('quadrant-styled')), WIDE);
    assert.doesNotMatch(bodyOf(output.systemMessage), /radius|color|class|#/);
  });

  it('draws the axis labels above, below and on the last row, and the quadrant names in the corners', () => {
    const { output } = runStopHook(fence(fixture('quadrant')), WIDE);
    const rows = bodyOf(output.systemMessage).split('\n');
    assert.equal(rows[2], 'High Engagement');
    assert.match(rows[4], /^│ Need to promote {2,}│ {2,}We should expand │$/);
    assert.match(rows[rows.length - 4], /^│ Re-evaluate {2,}│ {2,}May be improved │$/);
    assert.equal(rows[rows.length - 2], 'Low Engagement');
    assert.match(rows[rows.length - 1], /^Low Reach {2,}High Reach$/);
  });

  it('renders at 27 columns and gives a notice at 26', () => {
    const fits = runStopHook(fence(fixture('quadrant')), { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '27' });
    assert.match(fits.output.systemMessage, /^mermaid-for-claude: diagram 1\/1 \(quadrantChart\)\n/);
    assert.ok(widestRow(bodyOf(fits.output.systemMessage)) <= 27, `widest row is ${widestRow(bodyOf(fits.output.systemMessage))}`);
    const notFit = runStopHook(fence(fixture('quadrant')), { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '26' });
    assert.equal(notFit.output.systemMessage, notice('quadrantChart', 'needs more than 26 columns'));
  });

  it('gives the unsupported line notice for a point outside 0..1 and for a line outside the subset', () => {
    const outside = runStopHook(fence('quadrantChart\n    A: [1.5, 0.5]\n'), WIDE);
    assert.equal(outside.output.systemMessage, notice('quadrantChart', 'unsupported line: A: [1.5, 0.5]'));
    const unknown = runStopHook(fence('quadrantChart\n    z-axis Left --> Right\n'), WIDE);
    assert.equal(unknown.output.systemMessage, notice('quadrantChart', 'unsupported line: z-axis Left --> Right'));
  });
});

describe('block', () => {
  it('lists edges under the grid as `A ──▶ B  label`, never as lines', () => {
    const { output } = runStopHook(fence(fixture('block-edges')), WIDE);
    const [grid, edges] = bodyOf(output.systemMessage).split('\n\n').slice(-2);
    assert.equal(edges, 'ID ──▶ D\nC ──▶ D\nA ──▶ DB  reads');
    assert.doesNotMatch(grid, /──▶|───\s/);
  });

  it('lists an undirected edge with a line glyph and an |x| label beside it', () => {
    const { output } = runStopHook(fence('block\n    a b\n    a --- b\n    a -->|x| b\n'), WIDE);
    assert.match(output.systemMessage, /\n\na ─── b\na ──▶ b {2}x$/);
  });

  it('puts every block of a level on one row with columns auto or no columns line', () => {
    const auto = runStopHook(fence(fixture('block-auto')), WIDE);
    assert.equal(auto.output.systemMessage, snapshot('block-auto'));
    const explicit = runStopHook(fence(fixture('block-auto').replace('block\n', 'block\n  columns auto\n')), WIDE);
    assert.equal(explicit.output.systemMessage, snapshot('block-auto'));
    assert.equal(bodyOf(auto.output.systemMessage).split('\n\n')[0].split('\n').length, 3, 'one boxed row');
  });

  it('wraps a span that does not fit the row and clips a span wider than the grid', () => {
    const { output } = runStopHook(fence('block\n    columns 2\n    a b:3 c\n'), WIDE);
    const rows = bodyOf(output.systemMessage).split('\n');
    assert.equal(rows.length, 9, 'three boxed rows: a, b, c');
    assert.match(rows[1], /^│ a │$/);
    assert.match(rows[4], /^│ {3,}b {3,}│$/, 'b spans the full two-column grid');
    assert.match(rows[7], /^│ c │/);
    assert.equal(widestRow(rows[3]), widestRow(rows[0]) * 2 + 1, 'the b box spans both columns and the gap');
  });

  it('lays a nested block without a columns line on one row, as mermaid does', () => {
    const { output } = runStopHook(fence(fixture('block-nested')), WIDE);
    assert.equal(output.systemMessage, snapshot('block-nested'));
    assert.match(output.systemMessage, /│ │ l │ │ m │ │ n │ │ o │ │ p │ │ q │ │ r │ │/);
    assert.match(output.systemMessage, /│ │ h │ │ i │ {17}│/, 'group1 keeps its own columns 2');
  });

  it('decodes HTML entities in labels without a dependency', () => {
    const source = 'block\n    a["Q &amp; A"] b["#quot;quoted#quot;"] c["&#9829;&#x2665; #9829;"] d["x&nbsp;y &lt;z&gt;"]\n';
    const { output } = runStopHook(fence(source), WIDE);
    assert.match(output.systemMessage, /│ Q & A │ │ "quoted" │ │ ♥♥ ♥ │ │ x y <z> │/);
  });

  it('draws a block arrow with two directions and a plain box for every shape', () => {
    const { output } = runStopHook(fence('block\n    columns 2\n    a(("round")) both<["Go"]>(right, down)\n    b{{"hex"}} c>"flag"]\n'), WIDE);
    assert.match(output.systemMessage, /│ round │ {2,}▼ Go ─▶$/m);
    assert.match(output.systemMessage, /│ {2}hex {2}│ │ {2}flag {3}│/, 'the arrow cell above widens the second column');
    assert.doesNotMatch(bodyOf(output.systemMessage), /[(){}>]/);
  });

  it('ignores style, classDef and class lines', () => {
    const { output } = runStopHook(fence(fixture('block')), WIDE);
    assert.doesNotMatch(bodyOf(output.systemMessage), /fill|front|back/);
  });

  it('gives the unsupported line notice for an unknown arrow direction and for a line outside the subset', () => {
    const arrow = runStopHook(fence('block\n    a<["x"]>(sideways)\n'), WIDE);
    assert.equal(arrow.output.systemMessage, notice('block', 'unsupported line: a<["x"]>(sideways)'));
    const unknown = runStopHook(fence('block\n    a --> b --> c\n'), WIDE);
    assert.equal(unknown.output.systemMessage, notice('block', 'unsupported line: a --> b --> c'));
  });

  it('keeps a hyphenated id alone on a line as a box, not an edge', () => {
    const { output } = runStopHook(fence('block\n    columns 1\n    api-gateway\n    auth-service\n    api-gateway --> auth-service\n'), WIDE);
    assert.match(output.systemMessage, /│ api-gateway {2}│\n[^\n]*\n[^\n]*\n│ auth-service │/);
    assert.match(output.systemMessage, /\n\napi-gateway ──▶ auth-service$/);
  });

  it('gives a notice for a block without end', () => {
    const { output } = runStopHook(fence('block\n    block:x\n      a\n'), WIDE);
    assert.equal(output.systemMessage, notice('block', 'block without end'));
  });
});

describe('treemap', () => {
  it('shows the share of the parent for a child and of the total for a root, with a total row for several roots', () => {
    const { output } = runStopHook(fence(fixture('treemap-flat')), WIDE);
    assert.equal(output.systemMessage, snapshot('treemap-flat'));
    assert.match(output.systemMessage, /^Category A {3}30 {2}42\.9%/m);
    assert.match(output.systemMessage, /^└── Item A2 {2}20 {2}66\.7%/m);
    assert.match(output.systemMessage, /^total {8}70$/m);
  });

  it('sums a node without a value from its children and formats decimals', () => {
    const { output } = runStopHook(fence('treemap\n    "All"\n        "A": 1.5\n        "B": 0.25\n        "C"\n            "C1": 1234.567\n'), WIDE);
    assert.match(output.systemMessage, /^All {9}1,236\.32 {2}100\.0%/m);
    assert.match(output.systemMessage, /^├── A {12}1\.5 {4}0\.1%/m);
    assert.match(output.systemMessage, /^├── B {11}0\.25 {4}0\.0%/m);
    assert.match(output.systemMessage, /^└── C {7}1,234\.57 {3}99\.9%/m);
    assert.match(output.systemMessage, /^ {4}└── C1 {2}1,234\.57 {2}100\.0%/m);
  });

  it('ignores :::class after a name or a value and classDef lines', () => {
    const { output } = runStopHook(fence(fixture('treemap-classes')), WIDE);
    assert.equal(output.systemMessage, snapshot('treemap-classes'));
    assert.doesNotMatch(bodyOf(output.systemMessage), /:::|big|small|fill/);
  });

  it('gives the unsupported line notice for an unquoted name and a notice when values add up to zero', () => {
    const unquoted = runStopHook(fence('treemap\n    Budget\n'), WIDE);
    assert.equal(unquoted.output.systemMessage, notice('treemap', 'unsupported line: Budget'));
    const zero = runStopHook(fence('treemap\n    "A": 0\n'), WIDE);
    assert.equal(zero.output.systemMessage, notice('treemap', 'values add up to zero'));
  });
});

describe('MERMAID_FOR_CLAUDE_ASCII=1', () => {
  for (const name of ['quadrant', 'quadrant-styled', 'block', 'block-edges', 'block-process', 'treemap']) {
    it(`draws the ${name} fixture with ASCII glyphs only`, () => {
      const { output } = runStopHook(fence(fixture(name)), ASCII);
      assert.equal(output.systemMessage, snapshot(`${name}.ascii`));
      assert.match(output.systemMessage, /^[\x20-\x7e\n]*$/, 'every character is printable ASCII');
    });
  }

  it('swaps the edge and block arrow glyphs', () => {
    const { output } = runStopHook(fence(fixture('block-edges')), ASCII);
    assert.match(output.systemMessage, /\n {20,}v\n/);
    assert.match(output.systemMessage, /\n\nID --> D\nC --> D\nA --> DB {2}reads$/);
  });
});

describe('MERMAID_FOR_CLAUDE_MAX_WIDTH=60', () => {
  for (const [, name] of ALL) {
    it(`fits the ${name} fixture inside 60 columns`, () => {
      const { output } = runStopHook(fence(fixture(name)), NARROW);
      assert.match(output.systemMessage, /^mermaid-for-claude: diagram 1\/1/);
      assert.ok(widestRow(bodyOf(output.systemMessage)) <= 60, `widest row is ${widestRow(bodyOf(output.systemMessage))}`);
    });
  }

  it('narrows the quadrants and moves a crowded label one row below', () => {
    const { output } = runStopHook(fence(fixture('quadrant-styled')), NARROW);
    assert.equal(output.systemMessage, snapshot('quadrant-styled.narrow'));
    assert.match(output.systemMessage, /│ Built-in S tier ●● {9}│[^\n]*\n│ {14}Crowded B {5}│/);
  });

  it('shortens the treemap bars to fit', () => {
    const { output } = runStopHook(fence(fixture('treemap')), NARROW);
    assert.equal(output.systemMessage, snapshot('treemap.narrow'));
    assert.equal(widestRow(bodyOf(output.systemMessage)), 60);
  });

  it('wraps block labels narrower to fit', () => {
    const source = `block\n    columns 2\n    a["${'word '.repeat(12).trim()}"] b["${'other '.repeat(10).trim()}"]\n`;
    const { output } = runStopHook(fence(source), NARROW);
    assert.match(output.systemMessage, /^mermaid-for-claude: diagram 1\/1 \(block\)\n/);
    assert.ok(widestRow(bodyOf(output.systemMessage)) <= 60);
    assert.ok(bodyOf(output.systemMessage).split('\n').length > 4, 'labels wrap over several lines');
  });

  it('gives a notice when the grid cannot fit', () => {
    const { output } = runStopHook(fence('block\n    a b c d e f g h i j\n'), { ...WIDE, MERMAID_FOR_CLAUDE_MAX_WIDTH: '40' });
    assert.equal(output.systemMessage, notice('block', 'needs more than 40 columns'));
  });
});
