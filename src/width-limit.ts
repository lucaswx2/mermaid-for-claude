// Width limit (ADR-0005, ADR-0008): MERMAID_FOR_CLAUDE_MAX_WIDTH when it is a positive integer, else the
// measured terminal width minus the four columns the `Stop says:` block indents by, else 120. The
// SessionStart script carries a second copy of the default and the indent; a parity test keeps them equal.
// Value-import free on purpose: test/session-start.test.mjs transpiles this file on its own.
import type { Rendered } from './render-block.js';
import type { TerminalWidth } from './terminal-width.js';

export const DEFAULT_WIDTH_LIMIT = 120;
export const STOP_SAYS_INDENT = 4;

export const positiveInteger = (text: string | undefined) => {
  const trimmed = text?.trim() ?? '';
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : undefined;
};

export const widthLimitFor = (terminal: TerminalWidth) =>
  terminal.source !== 'none' && terminal.columns > STOP_SAYS_INDENT ? terminal.columns - STOP_SAYS_INDENT : DEFAULT_WIDTH_LIMIT;

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
