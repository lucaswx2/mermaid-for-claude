// The Stop hook seam driven with dispatcher fixtures (ticket #19, ADR-0006 rules): every header spelling
// reaches the right renderer or the right notice. Diagrams are compared with a snapshot per fixture under
// test/snapshots; notices with their exact text. Nothing here imports the dispatcher directly.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fence, fixture, runStopHook, snapshot } from './seams/stop-hook.mjs';

const notice = (position, type, reason) => `mermaid-for-claude: could not render diagram ${position} (${type}): ${reason}`;
const withHeader = (source, header) => source.replace(/^[^\n]*/, header);

describe('rendering the six baseline types', () => {
  for (const name of ['baseline-sequence', 'baseline-state', 'baseline-class', 'baseline-er', 'baseline-xychart']) {
    it(`renders the ${name} fixture with compact padding`, () => {
      const { output } = runStopHook(fence(fixture(name)));
      assert.equal(output.systemMessage, snapshot(name));
    });
  }

  it('keeps the flowchart snapshot byte-identical', () => {
    const { output } = runStopHook(fence(fixture('flowchart')));
    assert.equal(output.systemMessage, snapshot('flowchart'));
  });
});

describe('header spellings', () => {
  const spellings = [
    ['graph TD', 'flowchart', 'flowchart'],
    ['flowchart: TD', 'flowchart', 'flowchart'],
    ['FLOWCHART TD', 'flowchart', 'flowchart'],
    ['stateDiagram-v2', 'baseline-state', 'baseline-state'],
    ['stateDiagram', 'baseline-state', 'baseline-state'],
    ['STATEDIAGRAM-V2', 'baseline-state', 'baseline-state'],
    ['xychart-beta', 'baseline-xychart', 'baseline-xychart'],
    ['xychart', 'baseline-xychart', 'baseline-xychart'],
    ['classDiagram-v2', 'baseline-class', 'baseline-class'],
    ['ClassDiagram:', 'baseline-class', 'baseline-class'],
    ['sequenceDiagram:', 'baseline-sequence', 'baseline-sequence'],
    ['erDiagram:', 'baseline-er', 'baseline-er'],
  ];
  for (const [header, fixtureName, snapshotName] of spellings) {
    it(`renders ${JSON.stringify(header)} as the canonical type`, () => {
      const { output } = runStopHook(fence(withHeader(fixture(fixtureName), header)));
      assert.equal(output.systemMessage, snapshot(snapshotName));
    });
  }

  it('renders the graph alias fixture under the flowchart name', () => {
    const { output } = runStopHook(fence(fixture('dispatcher-graph-alias')));
    assert.equal(output.systemMessage, snapshot('dispatcher-graph-alias'));
    assert.match(output.systemMessage, /^mermaid-for-claude: diagram 1\/1 \(flowchart\)\n/);
  });

  it('renders the classDiagram-v2 fixture under the classDiagram name', () => {
    const { output } = runStopHook(fence(fixture('dispatcher-class-v2')));
    assert.equal(output.systemMessage, snapshot('dispatcher-class-v2'));
    assert.match(output.systemMessage, /^mermaid-for-claude: diagram 1\/1 \(classDiagram\)\n/);
  });
});

describe('metadata before and inside the diagram', () => {
  it('renders a block with front matter, a multi-line init directive, comments and accessibility lines as if they were absent', () => {
    const { output } = runStopHook(fence(fixture('dispatcher-metadata')));
    assert.equal(output.systemMessage, snapshot('flowchart'));
  });

  it('renders a sequence diagram preceded by a one-line directive and a comment', () => {
    const source = `%%{init: {'theme': 'dark'}}%%\n%% a comment\n${fixture('baseline-sequence')}`;
    const { output } = runStopHook(fence(source));
    assert.equal(output.systemMessage, snapshot('baseline-sequence'));
  });

  it('keeps accTitle and accDescr lines out of a sequence diagram', () => {
    const source = fixture('baseline-sequence').replace('\n    participant U', '\n    accTitle: Orders\n    accDescr: How an order flows\n    participant U');
    const { output } = runStopHook(fence(source));
    assert.equal(output.systemMessage, snapshot('baseline-sequence'));
  });
});

describe('notice-only types', () => {
  const headers = [
    ['requirementDiagram', 'requirementDiagram'],
    ['C4Context', 'C4'],
    ['C4Container', 'C4'],
    ['C4Component', 'C4'],
    ['C4Dynamic', 'C4'],
    ['C4Deployment', 'C4'],
    ['sankey-beta', 'sankey'],
    ['architecture-beta', 'architecture'],
    ['zenuml', 'zenuml'],
    ['info', 'info'],
  ];
  for (const [header, canonical] of headers) {
    it(`gives the unsupported type notice for ${header} under the ${canonical} name`, () => {
      const { output } = runStopHook(fence(`${header}\n    A --> B\n`));
      assert.equal(output.systemMessage, notice('1/1', canonical, 'unsupported type'));
    });
  }

  it('gives the unsupported type notice for a built-in type slot without a renderer yet', () => {
    const { output } = runStopHook(fence('gantt\n    title Plan\n    A task : a1, 2026-01-01, 3d\n'));
    assert.equal(output.systemMessage, notice('1/1', 'gantt', 'unsupported type'));
  });

  it('prints the canonical name for a built-in slot spelled with a suffix', () => {
    const { output } = runStopHook(fence('block-beta\n    a b c\n'));
    assert.equal(output.systemMessage, notice('1/1', 'block', 'unsupported type'));
  });
});

describe('unknown headers', () => {
  it('gives the unsupported type notice with the raw token and the next block still renders', () => {
    const { output } = runStopHook(`${fence('foo TD\n    A --> B\n')}\n${fence(fixture('flowchart'))}`);
    const [first, ...rest] = output.systemMessage.split('\n\n');
    assert.equal(first, notice('1/2', 'foo', 'unsupported type'));
    assert.equal(rest.join('\n\n'), snapshot('flowchart').replace('diagram 1/1', 'diagram 2/2'));
  });

  it('gives the unsupported type notice for an empty block', () => {
    const { output } = runStopHook(fence(''));
    assert.equal(output.systemMessage, notice('1/1', 'unknown', 'unsupported type'));
  });
});

describe('a baseline render that fails', () => {
  it('turns a thrown error into a notice with the first line of its message cut at 100 characters, and the next block still renders', () => {
    const { output } = runStopHook(`${fence('flowchart SIDEWAYS\n    A --> B\n')}\n${fence(fixture('flowchart'))}`);
    const [first, ...rest] = output.systemMessage.split('\n\n');
    const message = 'Invalid mermaid header: "flowchart SIDEWAYS". Expected "graph TD", "flowchart LR", "stateDiagram-v2", etc.';
    assert.ok(message.length > 100, 'the probe message must exceed 100 characters to exercise the cut');
    assert.equal(first, notice('1/2', 'flowchart', message.slice(0, 100)));
    assert.equal(rest.join('\n\n'), snapshot('flowchart').replace('diagram 1/1', 'diagram 2/2'));
  });

  it('turns empty renderer output into the empty output notice', () => {
    const { output } = runStopHook(fence('flowchart TD\n    subgraph S\n    end\n'));
    assert.equal(output.systemMessage, notice('1/1', 'flowchart', 'empty output'));
  });
});
