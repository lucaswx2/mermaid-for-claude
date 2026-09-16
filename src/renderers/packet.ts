// packet (ADR-0006): an RFC-style bit table with a ruler, 32 bits per row, 16 or 8 under narrower
// limits, a multi-row field drawn as one tall cell, tiny cells stacking letters vertically. Subset:
// `packet` or `packet-beta`, `title`, `a-b: "label"`, `a: "label"`, `+n: "label"`; fields contiguous
// from bit 0, so a gap or an overlap is a notice.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor, junction } from '../glyphs.js';
import { center, codePointLength, cut, RenderError, unsupportedLine, wrap } from '../text.js';

type Field = { start: number; end: number; label: string };
type Segment = { field: number; start: number; end: number; innerWidth: number; lines: string[] };

const FIELD = /^(\+?)(\d+)(?:\s*-\s*(\d+))?\s*:\s*"([^"]*)"$/;
// Each bit takes two columns (a glyph and a border), plus the left border.
const BITS_PER_ROW = [32, 16, 8];
const tableWidth = (bits: number) => 2 * bits + 1;
const STACK_WIDTH_MAX = 3;

const parseFields = (lines: string[], ellipsis: string) => {
  let title = '';
  const fields: Field[] = [];
  let next = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^title\b/i.test(line)) {
      title = line.replace(/^title\b/i, '').trim();
      continue;
    }
    const match = line.match(FIELD);
    if (!match) throw unsupportedLine(line, ellipsis);
    const [, relative, first = '0', second, label = ''] = match;
    const start = relative ? next : Number(first);
    const end = relative ? next + Number(first) - 1 : second === undefined ? start : Number(second);
    if (start !== next) throw new RenderError(`bit ${start} does not follow bit ${next - 1}`);
    if (end < start) throw new RenderError(`bits ${start}-${end} run backwards`);
    fields.push({ start, end, label });
    next = end + 1;
  }
  if (fields.length === 0) throw new RenderError('no fields');
  return { title, fields, bitCount: next };
};

// Label lines for one cell: wrapped when the words fit, one character per line in a tiny cell.
const labelLines = (label: string, innerWidth: number) => {
  const words = label.split(/\s+/).filter(Boolean);
  if (innerWidth <= STACK_WIDTH_MAX && words.some((word) => codePointLength(word) > innerWidth)) return [...label.replace(/\s+/g, '')];
  return wrap(label, innerWidth);
};

export const renderPacket = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^packet(-beta)?$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const { title, fields, bitCount } = parseFields(lines, glyphs.ellipsis);

  const bits = BITS_PER_ROW.find((candidate) => tableWidth(candidate) <= widthLimit);
  if (!bits) throw new RenderError(`needs more than ${widthLimit} columns`);
  const rowCount = Math.ceil(bitCount / bits);
  const rowBits = (row: number) => (row === rowCount - 1 ? bitCount - row * bits : bits);

  // The field index at every bit, filled once so each cell lookup is constant.
  const fieldByBit = new Array<number>(bitCount);
  fields.forEach((field, index) => fieldByBit.fill(index, field.start, field.end + 1));
  const fieldAt = (row: number, bit: number) => (bit < rowBits(row) ? (fieldByBit[row * bits + bit] ?? -1) : -1);
  // A vertical border stands after `bit` on `row`; `bit` -1 is the left border.
  const boundary = (row: number, bit: number) => row >= 0 && row < rowCount && (bit === -1 || bit === rowBits(row) - 1 || fieldAt(row, bit) !== fieldAt(row, bit + 1));
  // The field at `bit` on `row` is the same as on the row above, so the separator opens into a tall cell.
  const continues = (row: number, bit: number) => row > 0 && row < rowCount && fieldAt(row - 1, bit) >= 0 && fieldAt(row - 1, bit) === fieldAt(row, bit);

  const separator = (row: number) => {
    const extent = (bit: number) => (row > 0 && bit < rowBits(row - 1)) || (row < rowCount && bit < rowBits(row));
    let line = '';
    for (let bit = -1; bit < bits; bit += 1) {
      if (bit >= 0) line += extent(bit) ? (continues(row, bit) ? ' ' : glyphs.horizontal) : ' ';
      line += junction(glyphs, {
        up: row > 0 && boundary(row - 1, bit),
        down: row < rowCount && boundary(row, bit),
        left: bit >= 0 && extent(bit) && !continues(row, bit),
        right: bit + 1 < bits && extent(bit + 1) && !continues(row, bit + 1),
      });
    }
    return line;
  };

  // A field's label sits on the middle row of the rows it spans.
  const labelRow = (field: Field) => Math.floor((Math.floor(field.start / bits) + Math.floor(field.end / bits)) / 2);
  const contentRows = (row: number) => {
    const segments: Segment[] = [];
    for (let bit = 0; bit < rowBits(row); bit += 1) {
      const field = fieldAt(row, bit);
      const last = segments[segments.length - 1];
      if (last && last.field === field) last.end = bit;
      else segments.push({ field, start: bit, end: bit, innerWidth: 0, lines: [] });
    }
    for (const segment of segments) {
      const field = fields[segment.field];
      segment.innerWidth = 2 * (segment.end - segment.start + 1) - 1;
      segment.lines = field && labelRow(field) === row ? labelLines(field.label, segment.innerWidth) : [];
    }
    const height = Math.max(1, ...segments.map((segment) => segment.lines.length));
    const out: string[] = [];
    for (let index = 0; index < height; index += 1) {
      let line = glyphs.vertical;
      for (const segment of segments) {
        const offset = Math.floor((height - segment.lines.length) / 2);
        const text = segment.lines[index - offset] ?? '';
        line += center(cut(text, segment.innerWidth, glyphs.ellipsis), segment.innerWidth) + (boundary(row, segment.end) ? glyphs.vertical : ' ');
      }
      out.push(line);
    }
    return out;
  };

  const rows: string[] = [];
  if (title) rows.push(cut(title, widthLimit, glyphs.ellipsis), '');
  let tens = ' ';
  let units = ' ';
  for (let bit = 0; bit < bits; bit += 1) {
    tens += (bit % 10 === 0 ? String(Math.floor(bit / 10) % 10) : ' ') + ' ';
    units += String(bit % 10) + ' ';
  }
  rows.push(tens, units);
  for (let row = 0; row < rowCount; row += 1) rows.push(separator(row), ...contentRows(row));
  rows.push(separator(rowCount));
  return rows;
};
