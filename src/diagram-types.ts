// The type table the dispatcher routes by (ADR-0004, ADR-0006): keyed by the lowercased header token
// without a -beta / -v2 suffix; a trailing ':' comes off in diagram-header.ts, before the key is read
// (#38), so every renderer and the table agree on one spelling. `name` is the canonical type name printed in
// headers and notices (spec #16). A baseline entry carries the header token the baseline renderer accepts;
// a builtin entry carries the renderer written in this plugin for that type; a notice entry only ever
// produces the `unsupported type` notice.
import { renderBlockDiagram } from './renderers/block.js';
import { renderGantt } from './renderers/gantt.js';
import { renderGitGraph } from './renderers/git-graph.js';
import { renderJourney } from './renderers/journey.js';
import { renderKanban } from './renderers/kanban.js';
import { renderMindmap } from './renderers/mindmap.js';
import { renderPacket } from './renderers/packet.js';
import { renderPie } from './renderers/pie.js';
import { renderQuadrant } from './renderers/quadrant.js';
import { renderRadar } from './renderers/radar.js';
import { renderTimeline } from './renderers/timeline.js';
import { renderTreemap } from './renderers/treemap.js';

export type BuiltinInput = { headerLine: string; lines: string[]; widthLimit: number; useAscii: boolean };
export type BuiltinRender = (input: BuiltinInput) => string[];

export type DiagramType =
  | { kind: 'baseline'; name: string; header: string }
  | { kind: 'builtin'; name: string; render: BuiltinRender }
  | { kind: 'notice'; name: string };

const baseline = (name: string, header = name) => ({ kind: 'baseline', name, header }) satisfies DiagramType;
const builtin = (name: string, render: BuiltinRender) => ({ kind: 'builtin', name, render }) satisfies DiagramType;
const notice = (name: string) => ({ kind: 'notice', name }) satisfies DiagramType;

export const DIAGRAM_TYPES: Readonly<Record<string, DiagramType>> = {
  flowchart: baseline('flowchart'),
  graph: baseline('flowchart'),
  sequencediagram: baseline('sequenceDiagram'),
  statediagram: baseline('stateDiagram', 'stateDiagram-v2'),
  classdiagram: baseline('classDiagram'),
  erdiagram: baseline('erDiagram'),
  xychart: baseline('xychart', 'xychart-beta'),
  // Built-in renderers (ADR-0006, ADR-0007).
  pie: builtin('pie', renderPie),
  gitgraph: builtin('gitGraph', renderGitGraph),
  mindmap: builtin('mindmap', renderMindmap),
  journey: builtin('journey', renderJourney),
  timeline: builtin('timeline', renderTimeline),
  kanban: builtin('kanban', renderKanban),
  packet: builtin('packet', renderPacket),
  radar: builtin('radar', renderRadar),
  gantt: builtin('gantt', renderGantt),
  quadrantchart: builtin('quadrantChart', renderQuadrant),
  block: builtin('block', renderBlockDiagram),
  treemap: builtin('treemap', renderTreemap),
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

export const diagramTypeKey = (token: string) => token.toLowerCase().replace(/-(beta|v2)$/, '');
