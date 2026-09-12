// PROTOTYPE - throwaway. mindmap: indentation tree drawn with tree glyphs; shapes are stripped to text.
// Subset: one root, nodes by indentation, shapes [ ] ( ) (( )) )) (( ) ( {{ }}, <br/> line breaks;
// `::icon(...)` and `:::class` are ignored.
import { fail, cut, len, wrap, breaks } from '../text.mjs';

const SHAPES = [/^\(\((.*)\)\)$/, /^\)\)(.*)\(\($/, /^\)(.*)\($/, /^\{\{(.*)\}\}$/, /^\[(.*)\]$/, /^\((.*)\)$/];

const nodeText = (line) => {
  let text = line.replace(/:::\S+$/, '').trim();
  const body = text.match(/^[\w-]*\s*([([{)].*)$/)?.[1] ?? text;
  for (const shape of SHAPES) {
    const m = body.match(shape);
    if (m) {
      text = m[1];
      break;
    }
  }
  return breaks(text.trim().replace(/^"(.*)"$/, '$1').replace(/^`(.*)`$/, '$1'));
};

export const renderMindmap = ({ header, lines, maxWidth, g }) => {
  if (!/^mindmap$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  let root = null;
  const stack = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^::icon\(/.test(line) || /^:::/.test(line)) continue;
    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const node = { text: nodeText(line), children: [] };
    if (!node.text) fail(`empty node: ${cut(line, 40, g)}`);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!stack.length) {
      if (root) fail('more than one root');
      root = node;
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ indent, node });
  }
  if (!root) fail('no root');

  const rows = [];
  const emit = (node, prefix, childPrefix) => {
    const available = maxWidth - len(prefix);
    if (available < 10) fail(`too deep for ${maxWidth} columns`);
    const [first, ...rest] = wrap(node.text, available);
    rows.push(prefix + first);
    const continuation = childPrefix + (node.children.length ? g.treeBar : '    ');
    for (const line of rest) rows.push(continuation + line);
    node.children.forEach((child, i) => {
      const last = i === node.children.length - 1;
      emit(child, childPrefix + (last ? g.treeLast : g.treeTee), childPrefix + (last ? '    ' : g.treeBar));
    });
  };
  emit(root, '', '');
  return rows;
};
