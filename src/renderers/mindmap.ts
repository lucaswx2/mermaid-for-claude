// mindmap (ADR-0006): an indented tree drawn with tree glyphs, shapes stripped to their text.
// Subset: one root, nesting by indentation, shapes `[ ]`, `( )`, `(( ))`, `)) ((`, `) (`, `{{ }}`,
// `<br/>` as a line break; `::icon(...)` and `:::class` ignored.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor } from '../glyphs.js';
import { codePointLength, RenderError, unsupportedLine, wrap } from '../text.js';

type Node = { text: string; children: Node[] };

const SHAPES = [/^\(\((.*)\)\)$/, /^\)\)(.*)\(\($/, /^\)(.*)\($/, /^\{\{(.*)\}\}$/, /^\[(.*)\]$/, /^\((.*)\)$/];
const NARROWEST_LABEL = 10;

// mermaid labels break lines with <br/>; rendered as real line breaks.
const withLineBreaks = (text: string) => text.replace(/<br\s*\/?>/gi, '\n');

// `id[label]`, `id((label))`... give the label; a plain line is its own label. Quotes and backticks
// around the label come off.
const labelOf = (line: string) => {
  const text = line.replace(/:::\S+$/, '').trim();
  const body = text.match(/^[\w-]*\s*([([{)].*)$/)?.[1] ?? text;
  const inner = SHAPES.map((shape) => body.match(shape)?.[1]).find((match) => match !== undefined) ?? text;
  return withLineBreaks(inner.trim().replace(/^"(.*)"$/, '$1').replace(/^`(.*)`$/, '$1'));
};

const indentOf = (raw: string) => (raw.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length;

const parseTree = (lines: string[], ellipsis: string) => {
  let root: Node | undefined;
  const open: { indent: number; node: Node }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^::icon\(/.test(line) || /^:::/.test(line)) continue;
    const node: Node = { text: labelOf(line), children: [] };
    if (!node.text) throw unsupportedLine(line, ellipsis);
    const indent = indentOf(raw);
    while (open.length && (open[open.length - 1]?.indent ?? 0) >= indent) open.pop();
    const parent = open[open.length - 1];
    if (parent) parent.node.children.push(node);
    else if (root) throw unsupportedLine(line, ellipsis);
    else root = node;
    open.push({ indent, node });
  }
  if (!root) throw new RenderError('no root');
  return root;
};

export const renderMindmap = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^mindmap$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const root = parseTree(lines, glyphs.ellipsis);

  const rows: string[] = [];
  const emit = (node: Node, prefix: string, childPrefix: string) => {
    const available = widthLimit - codePointLength(prefix);
    if (available < NARROWEST_LABEL) throw new RenderError(`too deep for ${widthLimit} columns`);
    const [first = '', ...rest] = wrap(node.text, available);
    rows.push(prefix + first);
    const continuation = childPrefix + (node.children.length ? glyphs.treeBar : '    ');
    for (const line of rest) rows.push(continuation + line);
    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      emit(child, childPrefix + (last ? glyphs.treeLast : glyphs.treeTee), childPrefix + (last ? '    ' : glyphs.treeBar));
    });
  };
  emit(root, '', '');
  return rows;
};
