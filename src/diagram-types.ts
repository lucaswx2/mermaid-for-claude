// The type table the dispatcher routes by (ADR-0004, ADR-0006): keyed by the lowercased header token
// without a trailing ':' and without a -beta / -v2 suffix. `name` is the canonical type name printed in
// headers and notices (spec #16). A baseline entry carries the header token the baseline renderer accepts;
// a pending entry is a built-in slot whose renderer has not landed yet (tickets 7 to 10 turn each into a
// built-in entry); a notice entry only ever produces the `unsupported type` notice.
export type BuiltinInput = { headerLine: string; lines: string[]; widthLimit: number; useAscii: boolean };
export type BuiltinRender = (input: BuiltinInput) => string[];

export type DiagramType =
  | { kind: 'baseline'; name: string; header: string }
  | { kind: 'builtin'; name: string; render: BuiltinRender }
  | { kind: 'pending'; name: string }
  | { kind: 'notice'; name: string };

const baseline = (name: string, header = name) => ({ kind: 'baseline', name, header }) satisfies DiagramType;
const pending = (name: string) => ({ kind: 'pending', name }) satisfies DiagramType;
const notice = (name: string) => ({ kind: 'notice', name }) satisfies DiagramType;

export const DIAGRAM_TYPES: Readonly<Record<string, DiagramType>> = {
  flowchart: baseline('flowchart'),
  graph: baseline('flowchart'),
  sequencediagram: baseline('sequenceDiagram'),
  statediagram: baseline('stateDiagram', 'stateDiagram-v2'),
  classdiagram: baseline('classDiagram'),
  erdiagram: baseline('erDiagram'),
  xychart: baseline('xychart', 'xychart-beta'),
  // Built-in slots (ADR-0006, ADR-0007); each becomes `{ kind: 'builtin', name, render }` with its own ticket.
  pie: pending('pie'),
  gitgraph: pending('gitGraph'),
  mindmap: pending('mindmap'),
  journey: pending('journey'),
  timeline: pending('timeline'),
  kanban: pending('kanban'),
  packet: pending('packet'),
  radar: pending('radar'),
  gantt: pending('gantt'),
  quadrantchart: pending('quadrantChart'),
  block: pending('block'),
  treemap: pending('treemap'),
  // Notice-only in v1 (ADR-0004).
  requirementdiagram: notice('requirementDiagram'),
  c4context: notice('C4'),
  c4container: notice('C4'),
  c4component: notice('C4'),
  c4dynamic: notice('C4'),
  c4deployment: notice('C4'),
  sankey: notice('sankey'),
  architecture: notice('architecture'),
  zenuml: notice('zenuml'),
  info: notice('info'),
};

export const diagramTypeKey = (token: string) => token.replace(/:$/, '').toLowerCase().replace(/-(beta|v2)$/, '');
