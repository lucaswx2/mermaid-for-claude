// Coverage of the type table through the Stop hook seam (ticket #26, ADR-0004, ADR-0006, ADR-0007): every key of
// DIAGRAM_TYPES gets a minimal block and the result its kind promises (baseline and built-in render, notice-only
// gives `unsupported type`), every recommended type renders its fixture at 120 columns, and every built-in
// header also renders with a trailing colon (#38). The key list is a copy of src/diagram-types.ts; the counts
// keep it honest.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fence, fixture, runStopHook } from './seams/stop-hook.mjs';

const WIDE = { MERMAID_FOR_CLAUDE_MAX_WIDTH: '120', MERMAID_FOR_CLAUDE_ASCII: undefined };

const notice = (type, reason) => `mermaid-for-claude: could not render diagram 1/1 (${type}): ${reason}`;
const diagram = (type) => new RegExp(`^mermaid-for-claude: diagram 1/1 \\(${type}\\)\n`);

// [table key, kind, canonical name, header as written, minimal body]
const TOKENS = [
  ['flowchart', 'baseline', 'flowchart', 'flowchart TD', 'A --> B'],
  ['graph', 'baseline', 'flowchart', 'graph TD', 'A --> B'],
  ['sequencediagram', 'baseline', 'sequenceDiagram', 'sequenceDiagram', 'A->>B: hi'],
  ['statediagram', 'baseline', 'stateDiagram', 'stateDiagram-v2', '[*] --> S'],
  ['classdiagram', 'baseline', 'classDiagram', 'classDiagram', 'class A'],
  ['erdiagram', 'baseline', 'erDiagram', 'erDiagram', 'A ||--o{ B : has'],
  ['xychart', 'baseline', 'xychart', 'xychart-beta', 'x-axis [a, b]\n    bar [1, 2]'],
  ['pie', 'builtin', 'pie', 'pie', '"A" : 1'],
  ['gitgraph', 'builtin', 'gitGraph', 'gitGraph', 'commit'],
  ['mindmap', 'builtin', 'mindmap', 'mindmap', 'root'],
  ['journey', 'builtin', 'journey', 'journey', 'Go: 5: Me'],
  ['timeline', 'builtin', 'timeline', 'timeline', '2020 : event'],
  ['kanban', 'builtin', 'kanban', 'kanban', 'Todo\n      task'],
  ['packet', 'builtin', 'packet', 'packet-beta', '0-15: "Source Port"'],
  ['radar', 'builtin', 'radar', 'radar-beta', 'axis a["A"], b["B"]\n    curve c["C"]{1, 2}'],
  ['gantt', 'builtin', 'gantt', 'gantt', 'dateFormat YYYY-MM-DD\n    Task : 2024-01-01, 2d'],
  ['quadrantchart', 'builtin', 'quadrantChart', 'quadrantChart', 'A: [0.5, 0.5]'],
  ['block', 'builtin', 'block', 'block-beta', 'a b'],
  ['treemap', 'builtin', 'treemap', 'treemap-beta', '"A": 1'],
  ['requirementdiagram', 'notice', 'requirementDiagram', 'requirementDiagram', 'A --> B'],
  ['c4context', 'notice', 'C4', 'C4Context', 'A --> B'],
  ['c4container', 'notice', 'C4', 'C4Container', 'A --> B'],
  ['c4component', 'notice', 'C4', 'C4Component', 'A --> B'],
  ['c4dynamic', 'notice', 'C4', 'C4Dynamic', 'A --> B'],
  ['c4deployment', 'notice', 'C4', 'C4Deployment', 'A --> B'],
  ['sankey', 'notice', 'sankey', 'sankey-beta', 'A,B,1'],
  ['architecture', 'notice', 'architecture', 'architecture-beta', 'service a'],
  ['zenuml', 'notice', 'zenuml', 'zenuml', 'A.b()'],
  ['info', 'notice', 'info', 'info', 'showInfo'],
];

// The seventeen recommended types (src/recommended-types.ts) with the fixture each renders and the canonical
// name the header prints.
const RECOMMENDED = [
  ['flowchart', 'flowchart', 'flowchart'],
  ['sequenceDiagram', 'baseline-sequence', 'sequenceDiagram'],
  ['stateDiagram-v2', 'baseline-state', 'stateDiagram'],
  ['classDiagram', 'baseline-class', 'classDiagram'],
  ['xychart-beta', 'baseline-xychart', 'xychart'],
  ['pie', 'pie', 'pie'],
  ['gitGraph', 'gitgraph', 'gitGraph'],
  ['mindmap', 'mindmap', 'mindmap'],
  ['journey', 'journey', 'journey'],
  ['timeline', 'timeline', 'timeline'],
  ['kanban', 'kanban', 'kanban'],
  ['packet', 'packet', 'packet'],
  ['radar', 'radar', 'radar'],
  ['gantt', 'gantt', 'gantt'],
  ['quadrantChart', 'quadrant', 'quadrantChart'],
  ['block', 'block', 'block'],
  ['treemap', 'treemap', 'treemap'],
];

describe('the type table', () => {
  it('has twenty-nine keys for twenty-four header tokens: six baseline, twelve built-in, five notice-only and info', () => {
    assert.equal(TOKENS.length, 29);
    assert.equal(new Set(TOKENS.map(([key]) => key)).size, 29);
    assert.equal(new Set(TOKENS.map(([, , name]) => name)).size, 24);
    const byKind = (kind) => TOKENS.filter(([, k]) => k === kind);
    assert.equal(new Set(byKind('baseline').map(([, , name]) => name)).size, 6);
    assert.equal(byKind('builtin').length, 12);
    assert.equal(new Set(byKind('notice').map(([, , name]) => name)).size, 6, 'five notice-only types plus info');
  });

  for (const [key, kind, name, header, body] of TOKENS) {
    it(`routes the ${key} key (${header}) to a ${kind === 'notice' ? 'notice' : 'diagram'} under the ${name} name`, () => {
      const { output } = runStopHook(fence(`${header}\n    ${body}\n`), WIDE);
      if (kind === 'notice') {
        assert.equal(output.systemMessage, notice(name, 'unsupported type'));
        return;
      }
      assert.match(output.systemMessage, diagram(name));
    });
  }
});

describe('the seventeen recommended types', () => {
  it('are all listed here', () => {
    assert.equal(RECOMMENDED.length, 17);
  });

  for (const [type, fixtureName, name] of RECOMMENDED) {
    it(`renders ${type} from the ${fixtureName} fixture at 120 columns`, () => {
      const { output } = runStopHook(fence(fixture(fixtureName)), WIDE);
      assert.match(output.systemMessage, diagram(name));
    });
  }
});

// A trailing colon on the header token (ticket #38): mermaid's grammar spells `gitGraph:`, `gitGraph LR:`
// and `radar-beta:`, the type table has always ignored the colon when it picks the entry, and every
// built-in renderer now sees the header without it. `gitGraph LR:` rides on the gitgraph-plain fixture.
describe('a header token with a trailing colon', () => {
  for (const [, , name, header, body] of TOKENS.filter(([, kind]) => kind === 'builtin')) {
    it(`renders ${header}: as a ${name} diagram`, () => {
      const { output } = runStopHook(fence(`${header}:\n    ${body}\n`), WIDE);
      assert.match(output.systemMessage, diagram(name));
    });
  }

  it('still gives the unsupported type notice for an unknown token, and drops the colon from its name', () => {
    const { output } = runStopHook(fence('doodle:\n    A --> B\n'), WIDE);
    assert.equal(output.systemMessage, notice('doodle', 'unsupported type'));
  });

  it('still gives the unsupported line notice for a body line outside the subset', () => {
    const { output } = runStopHook(fence('pie:\n    Cats : 30\n'), WIDE);
    assert.equal(output.systemMessage, notice('pie', 'unsupported line: Cats : 30'));
  });
});
