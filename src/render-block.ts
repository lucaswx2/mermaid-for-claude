// Renders one diagram block's source into rows, or into the reason for a notice. The dispatcher
// (ADR-0006 rules) grows here; the hook only assembles what comes back.
import { renderMermaidASCII } from 'beautiful-mermaid';
import { firstErrorLine, logTrace } from './trace.js';

// Compact padding (ADR-0005); no colour because systemMessage shows none (ADR-0002).
const BASELINE_OPTIONS = { colorMode: 'none', paddingY: 3, paddingX: 3, boxBorderPadding: 0 } as const;

export type RenderOptions = { useAscii: boolean; widthLimit: number };
export type Rendered = { kind: 'diagram'; type: string; body: string } | { kind: 'notice'; type: string; reason: string };

export const renderBlock = (source: string, options: RenderOptions): Rendered => {
  const headerLine = source.split('\n').find((line) => line.trim()) ?? '';
  const type = headerLine.trim().split(/\s+/)[0] ?? 'unknown';
  try {
    const lines = renderMermaidASCII(source, { ...BASELINE_OPTIONS, useAscii: options.useAscii })
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''));
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    while (lines.length && !lines[0]) lines.shift();
    if (lines.length === 0) return { kind: 'notice', type, reason: 'empty output' };
    return { kind: 'diagram', type, body: lines.join('\n') };
  } catch (err) {
    logTrace(`rendering a ${type} block failed`, err);
    return { kind: 'notice', type, reason: firstErrorLine(err) };
  }
};
