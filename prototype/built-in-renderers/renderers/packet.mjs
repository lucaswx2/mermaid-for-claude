// PROTOTYPE - throwaway. packet: RFC-style bit-field table, 32 bits per row (16 or 8 in narrow limits),
// a bit ruler on top, fields spanning rows drawn as one tall cell, labels wrapped or stacked vertically.
// Subset: title, `a-b: "label"`, `a: "label"`, `+n: "label"`; fields must be contiguous from bit 0.
import { fail, cut, center, wrap, junction, len } from '../text.mjs';

export const renderPacket = ({ header, lines, maxWidth, g }) => {
  if (!/^packet(-beta)?$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  let title = '';
  const fields = [];
  let next = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^title\b/i.test(line)) {
      title = line.replace(/^title\b/i, '').trim();
      continue;
    }
    const m = line.match(/^(\+?)(\d+)(?:\s*-\s*(\d+))?\s*:\s*"([^"]*)"$/);
    if (!m) fail(`unsupported line: ${cut(line, 40, g)}`);
    const start = m[1] ? next : Number(m[2]);
    const end = m[1] ? next + Number(m[2]) - 1 : m[3] == null ? start : Number(m[3]);
    if (start !== next) fail(`bit ${start} does not follow bit ${next - 1}`);
    if (end < start) fail(`bits ${start}-${end} run backwards`);
    fields.push({ start, end, label: m[4] });
    next = end + 1;
  }
  if (!fields.length) fail('no fields');

  const bits = [32, 16, 8].find((b) => 2 * b + 1 <= maxWidth);
  if (!bits) fail(`needs more than ${maxWidth} columns`);
  const rowCount = Math.ceil(next / bits);
  const rowBits = (r) => (r === rowCount - 1 ? next - r * bits : bits);
  const fieldAt = (r, b) => (b < rowBits(r) ? fields.findIndex((f) => f.start <= r * bits + b && r * bits + b <= f.end) : -1);
  const boundary = (r, b) => (r < 0 || r >= rowCount ? false : b === -1 || b === rowBits(r) - 1 || fieldAt(r, b) !== fieldAt(r, b + 1));
  const continues = (r, b) => r > 0 && r < rowCount && fieldAt(r - 1, b) >= 0 && fieldAt(r - 1, b) === fieldAt(r, b);

  const separator = (r) => {
    const extent = (b) => (r > 0 && b < rowBits(r - 1)) || (r < rowCount && b < rowBits(r));
    let line = '';
    for (let b = -1; b < bits; b += 1) {
      if (b >= 0) line += extent(b) ? (continues(r, b) ? ' ' : g.h) : ' ';
      line += junction(g, {
        up: r > 0 && boundary(r - 1, b),
        down: r < rowCount && boundary(r, b),
        left: b >= 0 && extent(b) && !continues(r, b),
        right: b + 1 < bits && extent(b + 1) && !continues(r, b + 1),
      });
    }
    return line;
  };

  // Label lines per field: wrapped when words fit, stacked one character per line in tiny cells.
  const labelLines = (field, innerW) => {
    const words = field.label.split(/\s+/).filter(Boolean);
    if (words.some((w) => len(w) > innerW) && innerW <= 3) return [...field.label.replace(/\s+/g, '')];
    return wrap(field.label, innerW);
  };
  const labelRow = (field) => Math.floor((Math.floor(field.start / bits) + Math.floor(field.end / bits)) / 2);

  const contentRows = (r) => {
    const segments = [];
    for (let b = 0; b < rowBits(r); b += 1) {
      const f = fieldAt(r, b);
      if (segments.length && segments[segments.length - 1].f === f) segments[segments.length - 1].end = b;
      else segments.push({ f, start: b, end: b });
    }
    for (const s of segments) {
      s.innerW = 2 * (s.end - s.start + 1) - 1;
      s.lines = labelRow(fields[s.f]) === r ? labelLines(fields[s.f], s.innerW) : [];
    }
    const height = Math.max(1, ...segments.map((s) => s.lines.length));
    const out = [];
    for (let i = 0; i < height; i += 1) {
      let line = g.v;
      for (const s of segments) {
        const offset = Math.floor((height - s.lines.length) / 2);
        const text = s.lines[i - offset] ?? '';
        const inner = center(cut(text, s.innerW, g), s.innerW);
        line += inner + (boundary(r, s.end) ? g.v : ' ');
      }
      out.push(line);
    }
    return out;
  };

  const rows = [];
  if (title) rows.push(cut(title, maxWidth, g), '');
  let tens = ' ';
  let units = ' ';
  for (let b = 0; b < bits; b += 1) {
    tens += (b % 10 === 0 ? String(Math.floor(b / 10) % 10) : ' ') + ' ';
    units += String(b % 10) + ' ';
  }
  rows.push(tens, units);
  for (let r = 0; r < rowCount; r += 1) {
    rows.push(separator(r), ...contentRows(r));
  }
  rows.push(separator(rowCount));
  return rows;
};
