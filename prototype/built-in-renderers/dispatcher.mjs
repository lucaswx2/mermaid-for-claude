// PROTOTYPE - throwaway. Wayfinder ticket #13. Header dispatcher shared by every renderer (ADR-0004):
// strips front matter and %%{init}%% directives, resolves aliases (graph) and suffixes (-beta, -v2),
// routes to the baseline renderer or a built-in renderer, and turns every failure into a notice reason.

import { renderMermaidASCII } from 'beautiful-mermaid';
import { RenderError, glyphs, rtrim, widest } from './text.mjs';
import { renderPie } from './renderers/pie.mjs';
import { renderGitGraph } from './renderers/git-graph.mjs';
import { renderMindmap } from './renderers/mindmap.mjs';
import { renderJourney } from './renderers/journey.mjs';
import { renderTimeline } from './renderers/timeline.mjs';
import { renderKanban } from './renderers/kanban.mjs';
import { renderPacket } from './renderers/packet.mjs';
import { renderRadar } from './renderers/radar.mjs';

const baseline = (name, header = name) => ({ name, kind: 'baseline', header });
const builtin = (name, render) => ({ name, kind: 'builtin', render });
const notice = (name) => ({ name, kind: 'notice' });

// Keyed by the lowercased header token without a -beta / -v2 suffix.
const TYPES = {
  flowchart: baseline('flowchart'),
  graph: baseline('flowchart', 'graph'),
  sequencediagram: baseline('sequenceDiagram'),
  statediagram: baseline('stateDiagram', 'stateDiagram-v2'),
  classdiagram: baseline('classDiagram'),
  erdiagram: baseline('erDiagram'),
  xychart: baseline('xychart', 'xychart-beta'),
  pie: builtin('pie', renderPie),
  gitgraph: builtin('gitGraph', renderGitGraph),
  mindmap: builtin('mindmap', renderMindmap),
  journey: builtin('journey', renderJourney),
  timeline: builtin('timeline', renderTimeline),
  kanban: builtin('kanban', renderKanban),
  packet: builtin('packet', renderPacket),
  radar: builtin('radar', renderRadar),
  // M tier, wayfinder #14: notice until their prototype lands.
  gantt: notice('gantt'),
  quadrantchart: notice('quadrantChart'),
  block: notice('block'),
  treemap: notice('treemap'),
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

const BASELINE_OPTIONS = { colorMode: 'none', paddingY: 3, paddingX: 3, boxBorderPadding: 0 };

// Front matter (---\n...\n---) and directives (%%{ ... }%%, possibly multi-line) come off first;
// the baseline renderer rejects both. Comment lines (%%) and blank lines are dropped too.
export const prepare = (source) => {
  let text = source.replace(/\r\n?/g, '\n');
  const frontMatter = text.match(/^\s*---\n[\s\S]*?\n---[ \t]*\n?/);
  if (frontMatter) text = text.slice(frontMatter[0].length);
  text = text.replace(/%%\{[\s\S]*?\}%%/g, '');
  const lines = text.split('\n').map(rtrim).filter((l) => l.trim() && !/^\s*%%/.test(l));
  return { headerLine: (lines[0] ?? '').trim(), lines: lines.slice(1), allLines: lines };
};

// accTitle / accDescr are accessibility metadata every diagram type accepts; renderers never see them.
const withoutAccessibility = (lines) => {
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('}')) inBlock = false;
      continue;
    }
    if (/^accTitle\s*:/i.test(t)) continue;
    if (/^accDescr\s*\{/i.test(t)) {
      if (!t.includes('}')) inBlock = true;
      continue;
    }
    if (/^accDescr\s*:/i.test(t)) continue;
    out.push(line);
  }
  return out;
};

const typeKey = (token) => token.replace(/:$/, '').toLowerCase().replace(/-(beta|v2)$/, '');

export const renderBlock = (source, { maxWidth, ascii }) => {
  const { headerLine, lines, allLines } = prepare(source);
  const token = headerLine.split(/\s+/)[0] ?? '';
  const entry = TYPES[typeKey(token)];
  if (!entry) return { type: token || 'unknown', reason: 'unsupported type' };
  if (entry.kind === 'notice') return { type: entry.name, reason: 'unsupported type' };
  const g = glyphs(ascii);
  try {
    let rows;
    if (entry.kind === 'baseline') {
      // classDiagram-v2 is rejected by the baseline renderer; the rest of the header line stays.
      const header = headerLine.replace(/^\S+/, entry.header);
      rows = renderMermaidASCII([header, ...allLines.slice(1)].join('\n'), { ...BASELINE_OPTIONS, useAscii: ascii }).split('\n');
    } else {
      rows = entry.render({ header: headerLine, lines: withoutAccessibility(lines), maxWidth, g });
    }
    const body = rows.map(rtrim);
    while (body.length && !body[body.length - 1]) body.pop();
    while (body.length && !body[0]) body.shift();
    if (!body.length) return { type: entry.name, reason: 'empty output' };
    const width = widest(body);
    if (width > maxWidth) return { type: entry.name, reason: `${width} columns wide, limit is ${maxWidth}` };
    return { type: entry.name, body: body.join('\n') };
  } catch (err) {
    const message = err instanceof RenderError ? err.message : String(err?.message ?? err).split('\n')[0].slice(0, 100);
    return { type: entry.name, reason: message };
  }
};
