// The dispatcher (ADR-0006 rules): reads the header (diagram-header.ts strips the metadata every mermaid
// type accepts), routes the block to the baseline renderer, a built-in renderer or the `unsupported type`
// notice, and turns empty output or a thrown error into a notice. The hook only assembles what comes back.
import { renderMermaidASCII } from 'beautiful-mermaid';
import { readHeader } from './diagram-header.js';
import type { DiagramType } from './diagram-types.js';
import { rtrim } from './text.js';
import { firstErrorLine, logTrace } from './trace.js';

// Compact padding (ADR-0005); no colour because systemMessage shows none (ADR-0002).
const BASELINE_OPTIONS = { colorMode: 'none', paddingY: 3, paddingX: 3, boxBorderPadding: 0 } as const;

export type RenderOptions = { useAscii: boolean; widthLimit: number };
export type Rendered = { kind: 'diagram'; type: string; body: string } | { kind: 'notice'; type: string; reason: string };

const trimRows = (rows: string[]) => {
  const body = rows.map(rtrim);
  while (body.length && !body[body.length - 1]) body.pop();
  while (body.length && !body[0]) body.shift();
  return body;
};

// The render step for an entry that has a renderer, or undefined when the entry is notice-only.
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
  const { headerLine, lines, token, entry } = readHeader(source);
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
