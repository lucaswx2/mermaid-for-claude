// Width limit (ADR-0005, ADR-0008): MERMAID_FOR_CLAUDE_MAX_WIDTH when it is a positive integer, else 120.
// The live terminal width slots in between the two once it exists. The SessionStart script carries a
// second copy of the default; a parity test keeps the two equal.
import type { Rendered } from './render-block.js';

export const DEFAULT_WIDTH_LIMIT = 120;

export const resolveWidthLimit = (override: string | undefined) => {
  const trimmed = override?.trim() ?? '';
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : DEFAULT_WIDTH_LIMIT;
};

// Width is the widest row in code points (ADR-0005): emoji are banned, so no wide-glyph handling, but
// a surrogate pair is still one column, hence the spread instead of `.length`.
const widestRowInCodePoints = (body: string) => Math.max(...body.split('\n').map((row) => [...row].length));

// Measured after rendering, on what came back: the renderer itself is never trusted to fit.
export const enforceWidthLimit = (rendered: Rendered, widthLimit: number): Rendered => {
  if (rendered.kind !== 'diagram') return rendered;
  const width = widestRowInCodePoints(rendered.body);
  if (width <= widthLimit) return rendered;
  return { kind: 'notice', type: rendered.type, reason: `${width} columns wide, limit is ${widthLimit}` };
};
