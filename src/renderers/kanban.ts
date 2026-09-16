// kanban (ADR-0006): boxed side-by-side columns 10 to 28 characters wide, labels word-wrapped, the
// `@{ ticket, assigned, priority }` metadata under the item; more columns than fit give a notice.
// Subset: column at the first indentation level, item deeper, `id[label]`, `[label]`, plain text,
// optional `@{ key: value, ... }` after an item; keys outside the three shown are ignored.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor } from '../glyphs.js';
import { padEnd, RenderError, unsupportedLine, wrap } from '../text.js';

type Node = { text: string; meta: Record<string, string> };
type Column = { title: string; items: Node[] };

const BOXED = /^(?:[\w-]+)?\s*\[([^\]]*)\]\s*(?:@\{(.*)\})?\s*$/;
const TRAILING_META = /@\{(.*)\}\s*$/;
const META_ENTRY = /([\w-]+)\s*:\s*(?:'([^']*)'|"([^"]*)"|([^,}]+))/g;
const INNER_WIDTH_MAX = 28;
const INNER_WIDTH_MIN = 10;

const parseNode = (line: string): Node => {
  const boxed = line.match(BOXED);
  const text = boxed ? (boxed[1] ?? '') : line.replace(TRAILING_META, '').trim();
  const metaText = boxed ? boxed[2] : line.match(TRAILING_META)?.[1];
  const meta: Record<string, string> = {};
  for (const match of (metaText ?? '').matchAll(META_ENTRY)) meta[match[1] ?? ''] = (match[2] ?? match[3] ?? match[4] ?? '').trim();
  return { text: text.trim().replace(/^"(.*)"$/, '$1'), meta };
};

const metaLine = (meta: Record<string, string>) => [meta['ticket'] && `#${meta['ticket']}`, meta['assigned'], meta['priority']].filter(Boolean).join('  ');

const indentOf = (raw: string) => (raw.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length;

const parseColumns = (lines: string[], ellipsis: string) => {
  const columns: Column[] = [];
  let columnIndent: number | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    const node = parseNode(line);
    if (!node.text) throw unsupportedLine(line, ellipsis);
    const indent = indentOf(raw);
    columnIndent ??= indent;
    if (indent <= columnIndent) {
      columns.push({ title: node.text, items: [] });
      continue;
    }
    columns[columns.length - 1]?.items.push(node);
  }
  if (columns.length === 0) throw new RenderError('no columns');
  return columns;
};

export const renderKanban = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^kanban$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const columns = parseColumns(lines, glyphs.ellipsis);

  // Each column takes inner + 2 padding + 1 border; one border closes the table.
  const count = columns.length;
  const inner = Math.min(INNER_WIDTH_MAX, Math.floor((widthLimit - 1) / count) - 3);
  if (inner < INNER_WIDTH_MIN) throw new RenderError(`${count} columns do not fit in ${widthLimit} columns`);

  const titles = columns.map((column) => wrap(column.title, inner));
  const bodies = columns.map((column) =>
    column.items.flatMap((item, index) => {
      const itemRows = wrap(item.text, inner);
      const meta = metaLine(item.meta);
      if (meta) itemRows.push(...wrap(meta, inner - 2).map((row) => `  ${row}`));
      return index === 0 ? itemRows : ['', ...itemRows];
    }),
  );
  const titleHeight = Math.max(1, ...titles.map((title) => title.length));
  const bodyHeight = Math.max(1, ...bodies.map((body) => body.length));

  const row = (cells: string[]) => `${glyphs.vertical} ${cells.map((cell) => padEnd(cell, inner)).join(` ${glyphs.vertical} `)} ${glyphs.vertical}`;
  const rule = (left: string, middle: string, right: string) => `${left}${columns.map(() => glyphs.horizontal.repeat(inner + 2)).join(middle)}${right}`;
  const rows = [rule(glyphs.topLeft, glyphs.teeDown, glyphs.topRight)];
  for (let index = 0; index < titleHeight; index += 1) rows.push(row(titles.map((title) => title[index] ?? '')));
  rows.push(rule(glyphs.teeRight, glyphs.cross, glyphs.teeLeft));
  for (let index = 0; index < bodyHeight; index += 1) rows.push(row(bodies.map((body) => body[index] ?? '')));
  rows.push(rule(glyphs.bottomLeft, glyphs.teeUp, glyphs.bottomRight));
  return rows;
};
