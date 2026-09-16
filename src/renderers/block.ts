// block (ADR-0007): a grid of boxes across column spans, a nested block as a box holding its own grid, `space`
// as a gap, a block arrow as text with an arrow glyph, every shape drawn as a plain box, and edges listed
// under the grid as `A ──▶ B  label`, never drawn as lines. Subset: `block` / `block-beta`, `columns N|auto`,
// `id`, `id["label"]` in any bracket shape, `id:N`, `space[:N]`, `block[:id[:N]] ... end` with its own
// `columns`, `id<["label"]>(dir[, dir])` with `right left up down x y`, edges `a --> b`, `a --- b`,
// `a -- "x" --> b`, `a -->|x| b`; `style` / `classDef` / `class` lines ignored; HTML entities decoded.
// `columns auto` or no `columns` line puts every block of the level on one row, as mermaid does; a span
// that does not fit the row wraps to the next one.
import type { BuiltinInput } from '../diagram-types.js';
import type { Glyphs } from '../glyphs.js';
import { glyphsFor } from '../glyphs.js';
import { center, cut, padEnd, RenderError, unsupportedLine, widestRow, wrap } from '../text.js';

type Direction = 'right' | 'left' | 'up' | 'down' | 'x' | 'y';
type Item =
  | { kind: 'space'; span: number }
  | { kind: 'node'; id: string; label: string; span: number }
  | { kind: 'arrow'; id: string; label: string; directions: Direction[]; span: number }
  | { kind: 'block'; id: string; columns: number | undefined; children: Item[]; span: number };
type Edge = { from: string; to: string; arrow: boolean; label: string };
type Cell = { item: Item; row: number; col: number; span: number; lines: string[]; width: number };

const ID = String.raw`\w+(?:-\w+)*`;
const COLUMNS = /^columns\s+(\d+|auto)$/i;
const BLOCK_OPEN = new RegExp(`^block(?::(${ID}))?(?::(\\d+))?$`, 'i');
const EDGE = new RegExp(`^(${ID})\\s*([-=.]+)(?:\\s*"([^"]*)"\\s*([-=.]+))?\\s*(>?)\\s*(?:\\|([^|]*)\\|\\s*)?(${ID})$`);
const SPACE = /^space(?::(\d+))?$/;
const ARROW = new RegExp(`^(${ID})<\\[(.*)\\]>\\(([^)]*)\\)(?::(\\d+))?$`);
const NODE = new RegExp(`^(${ID})?(.*?)(?::(\\d+))?$`);
const SHAPE_OPEN = /^[[({>\\/]/;
const DIRECTIONS: ReadonlySet<string> = new Set(['right', 'left', 'up', 'down', 'x', 'y']);
// Cell text width caps tried in turn until the grid fits the width limit.
const CELL_WIDTH_LADDER = [24, 20, 16, 12, 10, 8, 6];
// Borders and one space of padding on each side of a cell's text, and the gap between two columns.
const CELL_FRAME = 4;
const COLUMN_GAP = 1;

const NAMED_ENTITIES: Readonly<Record<string, string>> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// `&amp;` and `&#9829;` as in HTML, `#quot;` and `#9829;` as mermaid spells them.
const ENTITY = /(?:&#|#|&)(x[0-9a-fA-F]+|[0-9]+|[a-zA-Z]+);/g;

const decodeEntities = (text: string) =>
  text.replace(ENTITY, (match, code: string) => {
    if (/^[a-zA-Z]/.test(code) && !/^x[0-9a-fA-F]+$/.test(code)) return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    const codePoint = code.startsWith('x') ? parseInt(code.slice(1), 16) : Number(code);
    return codePoint >= 0x20 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
  });

const cleanLabel = (text: string) =>
  decodeEntities(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .trim()
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();

// A row line split on whitespace outside brackets and quotes: `a["x y"] b:2 c<["z"]>(right)`.
const tokenize = (line: string) => {
  const tokens: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    if (!quoted && '[({<'.includes(char)) depth += 1;
    if (!quoted && '])}>'.includes(char)) depth -= 1;
    if (quoted || depth > 0 || !/\s/.test(char)) {
      current += char;
      continue;
    }
    if (current) tokens.push(current);
    current = '';
    depth = 0;
  }
  if (current) tokens.push(current);
  return tokens;
};

const spanOf = (text: string | undefined) => Math.max(1, Number(text ?? 1));

const parseItem = (token: string): Item | undefined => {
  const space = token.match(SPACE);
  if (space) return { kind: 'space', span: spanOf(space[1]) };
  const arrow = token.match(ARROW);
  if (arrow) {
    const directions = (arrow[3] ?? '').split(',').map((direction) => direction.trim().toLowerCase()).filter(Boolean);
    if (directions.length === 0 || !directions.every((direction): direction is Direction => DIRECTIONS.has(direction))) return undefined;
    return { kind: 'arrow', id: arrow[1] ?? '', label: cleanLabel(arrow[2] ?? ''), directions, span: spanOf(arrow[4]) };
  }
  const node = token.match(NODE);
  const [id, shape] = [node?.[1] ?? '', node?.[2] ?? ''];
  if (!node || !(id || shape) || (shape && !SHAPE_OPEN.test(shape))) return undefined;
  const label = shape ? cleanLabel(shape.replace(/^[[({>/\\]+/, '').replace(/[\])}/\\]+$/, '')) : id;
  return { kind: 'node', id: id || label, label, span: spanOf(node[3]) };
};

const ARROW_TEXT: Readonly<Record<Direction, (text: string, glyphs: Glyphs) => string>> = {
  right: (text, glyphs) => `${text} ${glyphs.arrowRight}`.trim(),
  left: (text, glyphs) => `${glyphs.arrowLeft} ${text}`.trim(),
  up: (text, glyphs) => `${glyphs.arrowUp} ${text}`.trim(),
  down: (text, glyphs) => `${glyphs.arrowDown} ${text}`.trim(),
  x: (text, glyphs) => `${glyphs.arrowLeft}${glyphs.arrowRight} ${text}`.trim(),
  y: (text, glyphs) => `${glyphs.arrowUp}${glyphs.arrowDown} ${text}`.trim(),
};

const parseDiagram = (lines: string[], ellipsis: string) => {
  const root: Item & { kind: 'block' } = { kind: 'block', id: '', columns: undefined, children: [], span: 1 };
  const open: (Item & { kind: 'block' })[] = [root];
  const edges: Edge[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const current = open[open.length - 1]!;
    if (/^(style|classDef|class)\b/i.test(line)) continue;
    const columns = line.match(COLUMNS);
    if (columns) {
      current.columns = columns[1]?.toLowerCase() === 'auto' ? undefined : Number(columns[1]);
      if (current.columns === 0) throw unsupportedLine(line, ellipsis);
      continue;
    }
    const nested = line.match(BLOCK_OPEN);
    if (nested) {
      const block: Item & { kind: 'block' } = { kind: 'block', id: nested[1] ?? '', columns: undefined, children: [], span: spanOf(nested[2]) };
      current.children.push(block);
      open.push(block);
      continue;
    }
    if (/^end$/i.test(line)) {
      if (open.length === 1) throw new RenderError('end without a block');
      open.pop();
      continue;
    }
    const edge = line.match(EDGE);
    if (edge) {
      edges.push({ from: edge[1] ?? '', to: edge[7] ?? '', arrow: edge[5] === '>', label: cleanLabel(edge[3] ?? edge[6] ?? '') });
      continue;
    }
    for (const token of tokenize(line)) {
      const item = parseItem(token);
      if (!item) throw unsupportedLine(line, ellipsis);
      current.children.push(item);
    }
  }
  if (open.length > 1) throw new RenderError('block without end');
  if (root.children.length === 0) throw new RenderError('no blocks');
  return { root, edges };
};

// Column widths: each single-span cell claims its column, then wider spans grow the columns they cover.
const columnWidths = (cells: Cell[], columns: number) => {
  const widths = Array<number>(columns).fill(1);
  for (const cell of cells.filter((cell) => cell.span === 1)) widths[cell.col] = Math.max(widths[cell.col] ?? 1, cell.width);
  for (const cell of cells.filter((cell) => cell.span > 1).sort((a, b) => a.span - b.span)) {
    const covered = widths.slice(cell.col, cell.col + cell.span).reduce((sum, width) => sum + width + CELL_FRAME, 0) + (cell.span - 1) * COLUMN_GAP - CELL_FRAME;
    const missing = cell.width - covered;
    if (missing <= 0) continue;
    for (let index = cell.col; index < cell.col + cell.span; index += 1) widths[index] = (widths[index] ?? 1) + Math.ceil(missing / cell.span);
  }
  return widths;
};

// Lays a block's children on its grid and returns the text rows; a nested block recurses with the same cap.
const layout = (block: Item & { kind: 'block' }, cellWidthCap: number, glyphs: Glyphs): string[] => {
  const columns = block.columns ?? Math.max(1, block.children.reduce((sum, child) => sum + child.span, 0));
  const cells: Cell[] = [];
  let row = 0;
  let cursor = 0;
  for (const item of block.children) {
    const span = Math.min(item.span, columns);
    if (cursor + span > columns) {
      row += 1;
      cursor = 0;
    }
    const lines = item.kind === 'node' ? (item.label ? wrap(item.label, cellWidthCap) : ['']) : item.kind === 'arrow' ? [cut(item.directions.reduce((text, direction) => ARROW_TEXT[direction](text, glyphs), item.label), cellWidthCap, glyphs.ellipsis)] : item.kind === 'block' ? layout(item, cellWidthCap, glyphs) : [];
    cells.push({ item, row, col: cursor, span, lines, width: widestRow(lines) });
    cursor += span;
  }
  const widths = columnWidths(cells, columns);
  // offsets[col] is the x where column `col` starts; offsets[columns] is one gap past the grid.
  const offsets = widths.reduce<number[]>((starts, width) => [...starts, (starts[starts.length - 1] ?? 0) + width + CELL_FRAME + COLUMN_GAP], [0]);
  const offset = (col: number) => offsets[col] ?? 0;
  const gridWidth = offset(columns) - COLUMN_GAP;
  const cellsByRow = Array.from({ length: row + 1 }, () => [] as Cell[]);
  for (const cell of cells) cellsByRow[cell.row]?.push(cell);

  const rows: string[] = [];
  for (const rowCells of cellsByRow) {
    const height = Math.max(1, ...rowCells.map((cell) => cell.lines.length));
    const canvas = Array.from({ length: height + 2 }, () => Array<string>(gridWidth).fill(' '));
    const put = (y: number, x: number, text: string) => [...text].forEach((char, position) => (canvas[y]![x + position] = char));
    for (const cell of rowCells) {
      if (cell.item.kind === 'space') continue;
      const x = offset(cell.col);
      const inner = offset(cell.col + cell.span) - COLUMN_GAP - x - 2;
      const top = Math.floor((height - cell.lines.length) / 2);
      if (cell.item.kind === 'arrow') {
        put(1 + top, x + 1, center(cell.lines[0] ?? '', inner));
        continue;
      }
      put(0, x, glyphs.topLeft + glyphs.horizontal.repeat(inner) + glyphs.topRight);
      for (let y = 0; y < height; y += 1) {
        const text = cell.lines[y - top] ?? '';
        const body = cell.item.kind === 'block' ? ` ${padEnd(text, inner - 1)}` : center(text, inner);
        put(1 + y, x, glyphs.vertical + body + glyphs.vertical);
      }
      put(height + 1, x, glyphs.bottomLeft + glyphs.horizontal.repeat(inner) + glyphs.bottomRight);
    }
    // A row with no box (arrows and spaces only) keeps just its middle lines.
    const boxed = rowCells.some((cell) => cell.item.kind === 'node' || cell.item.kind === 'block');
    rows.push(...(boxed ? canvas : canvas.slice(1, 1 + height)).map((line) => line.join('')));
  }
  return rows;
};

const labelsById = (block: Item & { kind: 'block' }, names = new Map<string, string>()) => {
  for (const child of block.children) {
    if (child.kind === 'block') labelsById(child, names);
    else if (child.kind !== 'space' && child.id) names.set(child.id, child.label || child.id);
  }
  return names;
};

// The widest cell cap on the ladder whose grid fits the width limit.
const fittedLayout = (root: Item & { kind: 'block' }, widthLimit: number, glyphs: Glyphs) => {
  for (const cap of CELL_WIDTH_LADDER) {
    const rows = layout(root, cap, glyphs);
    if (widestRow(rows) <= widthLimit) return rows;
  }
  throw new RenderError(`needs more than ${widthLimit} columns`);
};

export const renderBlockDiagram = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^block(-beta)?$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const { root, edges } = parseDiagram(lines, glyphs.ellipsis);

  const rows = fittedLayout(root, widthLimit, glyphs);
  if (edges.length === 0) return rows;

  const names = labelsById(root);
  rows.push('');
  for (const edge of edges) {
    const link = edge.arrow ? glyphs.edgeArrow : glyphs.edgeLine;
    const label = edge.label ? `  ${edge.label}` : '';
    rows.push(cut(`${names.get(edge.from) ?? edge.from} ${link} ${names.get(edge.to) ?? edge.to}${label}`, widthLimit, glyphs.ellipsis));
  }
  return rows;
};
