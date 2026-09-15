// Text helpers shared by the built-in renderers (ADR-0004, ADR-0006). Widths are measured in code
// points (ADR-0005): emoji are banned, so no wide-glyph handling, but a surrogate pair is one column.

// A line outside a renderer's grammar subset, or an input it cannot draw: the message is the notice.
export class RenderError extends Error {}

const NOTICE_LINE_WIDTH = 40;

export const codePointLength = (text: string) => [...text].length;
export const rtrim = (text: string) => text.replace(/\s+$/, '');
export const padEnd = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - codePointLength(text)));
export const padStart = (text: string, width: number) => ' '.repeat(Math.max(0, width - codePointLength(text))) + text;
export const widestRow = (rows: readonly string[]) => Math.max(0, ...rows.map(codePointLength));

export const cut = (text: string, width: number, ellipsis: string) =>
  codePointLength(text) <= width ? text : [...text].slice(0, Math.max(0, width - codePointLength(ellipsis))).join('') + ellipsis;

export const unsupportedLine = (line: string, ellipsis: string) => new RenderError(`unsupported line: ${cut(line.trim(), NOTICE_LINE_WIDTH, ellipsis)}`);

// Greedy word wrap per paragraph; a single word longer than `width` is hard-split.
export const wrap = (text: string, width: number) => {
  const rows: string[] = [];
  for (const paragraph of text.split('\n')) {
    let row = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      for (const piece of splitLongWord(word, width)) {
        if (!row) row = piece;
        else if (codePointLength(row) + 1 + codePointLength(piece) <= width) row += ` ${piece}`;
        else {
          rows.push(row);
          row = piece;
        }
      }
    }
    rows.push(row);
  }
  return rows;
};

const splitLongWord = (word: string, width: number) => {
  const pieces: string[] = [];
  let rest = [...word];
  while (rest.length > width) {
    pieces.push(rest.slice(0, width).join(''));
    rest = rest.slice(width);
  }
  pieces.push(rest.join(''));
  return pieces;
};
