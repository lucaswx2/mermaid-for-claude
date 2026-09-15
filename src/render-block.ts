// The dispatcher (ADR-0006 rules): strips the metadata every mermaid type accepts, reads the header token,
// routes the block to the baseline renderer, a built-in renderer or the `unsupported type` notice, and
// turns empty output or a thrown error into a notice. The hook only assembles what comes back.
import { renderMermaidASCII } from 'beautiful-mermaid';
import { DIAGRAM_TYPES, diagramTypeKey, type DiagramType } from './diagram-types.js';
import { firstErrorLine, logTrace } from './trace.js';

// Compact padding (ADR-0005); no colour because systemMessage shows none (ADR-0002).
const BASELINE_OPTIONS = { colorMode: 'none', paddingY: 3, paddingX: 3, boxBorderPadding: 0 } as const;

// A `---` block at the very start, and `%%{ ... }%%` directives anywhere, multi-line included.
const FRONT_MATTER = /^\s*---\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
const DIRECTIVE = /%%\{[\s\S]*?\}%%/g;
const COMMENT_LINE = /^\s*%%/;

export type RenderOptions = { useAscii: boolean; widthLimit: number };
export type Rendered = { kind: 'diagram'; type: string; body: string } | { kind: 'notice'; type: string; reason: string };

const rtrim = (line: string) => line.replace(/\s+$/, '');

// accTitle / accDescr are accessibility metadata every diagram type accepts; no renderer sees them. The
// baseline renderer would otherwise draw `accTitle: x` as a flowchart node.
const withoutAccessibility = (lines: string[]) => {
  const kept: string[] = [];
  let inDescrBlock = false;
  for (const line of lines) {
    const text = line.trim();
    if (inDescrBlock) {
      if (text.includes('}')) inDescrBlock = false;
      continue;
    }
    if (/^accTitle\s*:/i.test(text) || /^accDescr\s*:/i.test(text)) continue;
    if (/^accDescr\s*\{/i.test(text)) {
      inDescrBlock = !text.includes('}');
      continue;
    }
    kept.push(line);
  }
  return kept;
};

// Front matter, directives, comment lines, blank lines and accessibility lines come off before the header
// is read: the baseline renderer rejects front matter and multi-line directives outright, and for every
// type but flowchart and state it also rejects a comment or one-line directive ahead of the header.
const stripMetadata = (source: string) => {
  const text = source.replace(/\r\n?/g, '\n').replace(FRONT_MATTER, '').replace(DIRECTIVE, '');
  const lines = withoutAccessibility(text.split('\n').map(rtrim).filter((line) => line.trim() && !COMMENT_LINE.test(line)));
  return { headerLine: (lines[0] ?? '').trim(), lines: lines.slice(1) };
};

const trimRows = (rows: string[]) => {
  const body = rows.map(rtrim);
  while (body.length && !body[body.length - 1]) body.pop();
  while (body.length && !body[0]) body.shift();
  return body;
};

// The render step for an entry that has a renderer, or undefined when the entry is notice-only or pending.
// The baseline header token is rewritten to what the renderer accepts (`classDiagram-v2` to `classDiagram`,
// `flowchart: TD` to `flowchart TD`); the rest of the line stays.
const rendererFor = (entry: DiagramType, headerLine: string, lines: string[], options: RenderOptions) => {
  if (entry.kind === 'baseline') {
    const header = headerLine.replace(/^\S+/, entry.header);
    return () => renderMermaidASCII([header, ...lines].join('\n'), { ...BASELINE_OPTIONS, useAscii: options.useAscii }).split('\n');
  }
  if (entry.kind === 'builtin') {
    return () => entry.render({ headerLine, lines, widthLimit: options.widthLimit, useAscii: options.useAscii });
  }
  return undefined;
};

export const renderBlock = (source: string, options: RenderOptions): Rendered => {
  const { headerLine, lines } = stripMetadata(source);
  const token = headerLine.split(/\s+/)[0] ?? '';
  const entry = DIAGRAM_TYPES[diagramTypeKey(token)];
  if (!entry) return { kind: 'notice', type: token || 'unknown', reason: 'unsupported type' };

  const render = rendererFor(entry, headerLine, lines, options);
  if (!render) return { kind: 'notice', type: entry.name, reason: 'unsupported type' };

  try {
    const body = trimRows(render());
    if (body.length === 0) return { kind: 'notice', type: entry.name, reason: 'empty output' };
    return { kind: 'diagram', type: entry.name, body: body.join('\n') };
  } catch (err) {
    logTrace(`rendering a ${entry.name} block failed`, err);
    return { kind: 'notice', type: entry.name, reason: firstErrorLine(err) };
  }
};
