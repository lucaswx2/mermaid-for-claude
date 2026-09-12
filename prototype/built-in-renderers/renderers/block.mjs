// PROTOTYPE - throwaway. block: a grid of boxes across column spans, nested blocks as boxed sub-grids, `space`
// as an empty cell, block arrows as text with an arrow glyph, edges listed under the grid. Wayfinder ticket #14.
// Subset: `block` / `block-beta`, `columns N`, `id`, `id["label"]` in any bracket shape, `id:N`, `space[:N]`,
// `block[:id[:N]] ... end`, `id<["label"]>(dir[, dir])`, edges `a --> b`, `a --- b`, `a -- "x" --> b`,
// `a -->|x| b`; style / classDef / class lines ignored; shapes drawn as plain boxes.
import { fail, cut, center, wrap, breaks, widest, len } from '../text.mjs';

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '#quot;': '"' };
const cleanLabel = (text) =>
  breaks(text.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|#quot;/g, (e) => ENTITIES[e]))
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .trim();

// Splits a row line on whitespace outside brackets and quotes.
const tokenize = (line) => {
  const out = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && '[({<'.includes(ch)) depth += 1;
    if (!quoted && '])}>'.includes(ch)) depth -= 1;
    if (!quoted && depth <= 0 && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      depth = 0;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};

const EDGE = /^([\w-]+)\s*([-=.]+)(?:\s*"([^"]*)"\s*([-=.]+))?\s*(>?)\s*(?:\|([^|]*)\|\s*)?([\w-]+)$/;
const ARROW = /^([\w-]+)<\[(.*)\]>\(([^)]*)\)(?::(\d+))?$/;
const NODE = /^([\w-]+)?(.*?)(?::(\d+))?$/;
const DIRS = ['right', 'left', 'up', 'down', 'x', 'y'];

const parseItem = (token, g) => {
  let m;
  if ((m = token.match(/^space(?::(\d+))?$/))) return { kind: 'space', span: Number(m[1] ?? 1) };
  if ((m = token.match(ARROW))) {
    const dirs = m[3].split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (dirs.some((d) => !DIRS.includes(d))) fail(`unsupported arrow direction: ${cut(m[3], 20, g)}`);
    return { kind: 'arrow', id: m[1], label: cleanLabel(m[2]), dirs, span: Number(m[4] ?? 1) };
  }
  if ((m = token.match(NODE)) && (m[1] || m[2])) {
    const shape = m[2] ?? '';
    if (shape && !/^[[({>\\/]/.test(shape)) fail(`unsupported block: ${cut(token, 30, g)}`);
    const label = shape ? cleanLabel(shape.replace(/^[[({>/\\]+/, '').replace(/[\])}/\\]+$/, '')) : m[1];
    return { kind: 'node', id: m[1] ?? label, label, span: Number(m[3] ?? 1) };
  }
  fail(`unsupported block: ${cut(token, 30, g)}`);
};

const arrowText = (item, g) => {
  const glyph = {
    right: (t) => `${t} ${g.arrowRight}`.trim(),
    left: (t) => `${g.arrowLeft} ${t}`.trim(),
    up: (t) => `${g.arrowUp} ${t}`.trim(),
    down: (t) => `${g.arrowDown} ${t}`.trim(),
    x: (t) => `${g.arrowLeft}${g.arrowRight} ${t}`.trim(),
    y: (t) => `${g.arrowUp}${g.arrowDown} ${t}`.trim(),
  };
  return item.dirs.reduce((text, d) => glyph[d](text), item.label);
};

// Lays a block's children on its grid; returns text rows. Nested blocks recurse with the same cap.
const layout = (block, capW, g) => {
  const cols = block.columns ?? Math.max(1, block.children.reduce((s, c) => s + c.span, 0));
  const cells = [];
  let row = 0;
  let cursor = 0;
  for (const item of block.children) {
    const span = Math.min(item.span, cols);
    if (cursor + span > cols) {
      row += 1;
      cursor = 0;
    }
    let lines = [];
    if (item.kind === 'node') lines = item.label ? wrap(item.label, capW) : [''];
    else if (item.kind === 'arrow') lines = [cut(arrowText(item, g), capW, g)];
    else if (item.kind === 'block') lines = layout(item, capW, g);
    cells.push({ item, row, col: cursor, span, lines, width: widest(lines) });
    cursor += span;
  }
  const cw = Array(cols).fill(1);
  for (const cell of cells.filter((c) => c.span === 1)) cw[cell.col] = Math.max(cw[cell.col], cell.width);
  for (const cell of cells.filter((c) => c.span > 1).sort((a, b) => a.span - b.span)) {
    const have = cw.slice(cell.col, cell.col + cell.span).reduce((s, w) => s + w + 4, 0) + (cell.span - 1) - 4;
    const missing = cell.width - have;
    if (missing > 0) for (let k = 0; k < cell.span; k += 1) cw[cell.col + k] += Math.ceil(missing / cell.span);
  }
  const offset = (c) => cw.slice(0, c).reduce((s, w) => s + w + 4, 0) + c;
  const gridW = offset(cols) - 1;
  const out = [];
  const rowCount = row + 1;
  for (let r = 0; r < rowCount; r += 1) {
    const rowCells = cells.filter((c) => c.row === r);
    const height = Math.max(1, ...rowCells.map((c) => c.lines.length));
    const canvas = Array.from({ length: height + 2 }, () => Array(gridW).fill(' '));
    const put = (y, x, text) => [...text].forEach((ch, i) => (canvas[y][x + i] = ch));
    for (const cell of rowCells) {
      const x = offset(cell.col);
      const inner = offset(cell.col + cell.span) - 1 - x - 2;
      const top = Math.floor((height - cell.lines.length) / 2);
      if (cell.item.kind === 'space') continue;
      if (cell.item.kind === 'arrow') {
        put(1 + top, x + 1, center(cell.lines[0], inner));
        continue;
      }
      put(0, x, g.tl + g.h.repeat(inner) + g.tr);
      for (let y = 0; y < height; y += 1) {
        const text = cell.lines[y - top] ?? '';
        put(1 + y, x, g.v + (cell.item.kind === 'block' ? ' ' + text.padEnd(inner - 1) : center(text, inner)) + g.v);
      }
      put(height + 1, x, g.bl + g.h.repeat(inner) + g.br);
    }
    // A row with no box (arrows and spaces only) keeps just its middle line.
    const boxed = rowCells.some((c) => c.item.kind === 'node' || c.item.kind === 'block');
    out.push(...(boxed ? canvas : canvas.slice(1, 1 + height)).map((line) => line.join('')));
  }
  return out;
};

export const renderBlockDiagram = ({ header, lines, maxWidth, g }) => {
  if (!/^block(-beta)?$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  const root = { kind: 'block', columns: null, children: [], span: 1 };
  const stack = [root];
  const edges = [];
  let m;
  for (const raw of lines) {
    const line = raw.trim();
    const current = stack[stack.length - 1];
    if ((m = line.match(/^columns\s+(\d+|auto)$/i))) current.columns = m[1] === 'auto' ? null : Number(m[1]);
    else if ((m = line.match(/^block(?::([\w-]+))?(?::(\d+))?$/i))) {
      const nested = { kind: 'block', id: m[1] ?? '', columns: null, children: [], span: Number(m[2] ?? 1) };
      current.children.push(nested);
      stack.push(nested);
    } else if (/^end$/i.test(line)) {
      if (stack.length === 1) fail('end without a block');
      stack.pop();
    } else if (/^(style|classDef|class)\b/i.test(line)) continue;
    else if ((m = line.match(EDGE))) edges.push({ from: m[1], to: m[7], arrow: m[5] === '>', label: cleanLabel(m[3] ?? m[6] ?? '') });
    else for (const token of tokenize(line)) current.children.push(parseItem(token, g));
  }
  if (stack.length > 1) fail('block without end');
  if (!root.children.length) fail('no blocks');

  let rows = null;
  for (const capW of [24, 20, 16, 12, 10, 8, 6]) {
    const candidate = layout(root, capW, g);
    if (widest(candidate) <= maxWidth) {
      rows = candidate;
      break;
    }
  }
  if (!rows) fail(`grid does not fit in ${maxWidth} columns`);

  if (edges.length) {
    const names = new Map();
    const collect = (block) => block.children.forEach((c) => (c.kind === 'block' ? collect(c) : c.id && names.set(c.id, c.label || c.id)));
    collect(root);
    rows.push('');
    for (const e of edges) {
      const link = e.arrow ? g.edgeArrow : g.edgeLine;
      rows.push(cut(`${names.get(e.from) ?? e.from} ${link} ${names.get(e.to) ?? e.to}${e.label ? `  ${e.label}` : ''}`, maxWidth, g));
    }
  }
  return rows;
};
