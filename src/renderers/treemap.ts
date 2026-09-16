// treemap (ADR-0007): an indented tree with each node's value, its share of the parent (of the total for a
// root) and a bar scaled to that share; a total row when there are several roots. Subset: `treemap` /
// `treemap-beta`, `title`, `"name"` sections, `"name": value` leaves, nesting by indentation, `:::class`
// after a name or a value; `classDef` lines ignored. A node without a value is the sum of its children.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor } from '../glyphs.js';
import { cut, padEnd, padStart, RenderError, unsupportedLine, widestRow } from '../text.js';

type Node = { name: string; own: number | undefined; children: Node[] };
type Row = { text: string; value: number; share: number };

const NODE = /^"([^"]*)"(?::::[\w-]+)?(?:\s*:\s*(-?\d+(?:\.\d+)?)(?::::[\w-]+)?)?$/;
const NAME_WIDTH_MAX = 40;
const BAR_WIDTH_MAX = 30;
const BAR_WIDTH_MIN = 6;

const indentOf = (raw: string) => (raw.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length;
const formatValue = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const formatShare = (share: number) => `${(share * 100).toFixed(1)}%`;

const parseTree = (lines: string[], ellipsis: string) => {
  let title = '';
  const roots: Node[] = [];
  const open: { indent: number; node: Node }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^classDef\b/i.test(line)) continue;
    if (/^title\b/i.test(line)) {
      title = line.replace(/^title\b/i, '').trim();
      continue;
    }
    const match = line.match(NODE);
    if (!match) throw unsupportedLine(line, ellipsis);
    const node: Node = { name: match[1] ?? '', own: match[2] === undefined ? undefined : Number(match[2]), children: [] };
    const indent = indentOf(raw);
    while (open.length && (open[open.length - 1]?.indent ?? 0) >= indent) open.pop();
    const parent = open[open.length - 1];
    if (parent) parent.node.children.push(node);
    else roots.push(node);
    open.push({ indent, node });
  }
  if (roots.length === 0) throw new RenderError('no nodes');
  return { title, roots };
};

const valueOf = (node: Node): number => (node.children.length ? node.children.reduce((sum, child) => sum + valueOf(child), 0) : (node.own ?? 0));

export const renderTreemap = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^treemap(-beta)?$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const { title, roots } = parseTree(lines, glyphs.ellipsis);
  const total = roots.reduce((sum, root) => sum + valueOf(root), 0);
  if (total <= 0) throw new RenderError('values add up to zero');

  // Flattened with tree prefixes; the share is of the parent, of the total for a root.
  const flat: Row[] = [];
  const walk = (node: Node, prefix: string, last: boolean, depth: number, parentValue: number) => {
    const value = valueOf(node);
    const lead = depth === 0 ? '' : prefix + (last ? glyphs.treeLast : glyphs.treeTee);
    flat.push({ text: lead + node.name, value, share: parentValue > 0 ? value / parentValue : 0 });
    const childPrefix = depth === 0 ? '' : prefix + (last ? '    ' : glyphs.treeBar);
    node.children.forEach((child, index) => walk(child, childPrefix, index === node.children.length - 1, depth + 1, value));
  };
  roots.forEach((root, index) => walk(root, '', index === roots.length - 1, 0, total));

  const nameWidth = Math.min(NAME_WIDTH_MAX, widestRow(flat.map((row) => row.text)));
  const valueColumn = flat.map((row) => formatValue(row.value));
  const valueWidth = widestRow(valueColumn);
  const shareColumn = flat.map((row) => formatShare(row.share));
  const shareWidth = widestRow(shareColumn);
  const fixedWidth = nameWidth + 2 + valueWidth + 2 + shareWidth;
  if (fixedWidth > widthLimit) throw new RenderError(`needs more than ${widthLimit} columns`);
  const barWidth = Math.min(BAR_WIDTH_MAX, widthLimit - fixedWidth - 2);

  const rows: string[] = [];
  if (title) rows.push(cut(title, widthLimit, glyphs.ellipsis), '');
  flat.forEach((row, index) => {
    const filled = Math.round(row.share * barWidth);
    const bar = barWidth >= BAR_WIDTH_MIN ? `  ${glyphs.bar.repeat(filled)}${glyphs.barEmpty.repeat(barWidth - filled)}` : '';
    rows.push(`${padEnd(cut(row.text, nameWidth, glyphs.ellipsis), nameWidth)}  ${padStart(valueColumn[index] ?? '', valueWidth)}  ${padStart(shareColumn[index] ?? '', shareWidth)}${bar}`);
  });
  if (roots.length > 1) rows.push(`${padEnd('total', nameWidth)}  ${padStart(formatValue(total), valueWidth)}`);
  return rows;
};
