// PROTOTYPE - throwaway. treemap: an indented tree, each node with its value, its share of the parent and a bar
// scaled to that share. Wayfinder ticket #14.
// Subset: `treemap` / `treemap-beta`, optional title, `"name"` sections, `"name": value` leaves, nesting by
// indentation, `:::class` after a name or a value; classDef lines ignored.
import { fail, cut, padEnd, padStart, widest, len } from '../text.mjs';

const formatValue = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

export const renderTreemap = ({ header, lines, maxWidth, g }) => {
  if (!/^treemap(-beta)?$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  let title = '';
  const roots = [];
  const stack = []; // { indent, node }
  let m;
  for (const raw of lines) {
    const line = raw.trim();
    if ((m = line.match(/^title\s+(.*)$/i))) {
      title = m[1].trim();
      continue;
    }
    if (/^classDef\b/i.test(line)) continue;
    m = line.match(/^"([^"]*)"(?::::[\w-]+)?(?:\s*:\s*(-?\d+(?:\.\d+)?)(?::::[\w-]+)?)?$/);
    if (!m) fail(`unsupported line: ${cut(line, 40, g)}`);
    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const node = { name: m[1], own: m[2] === undefined ? null : Number(m[2]), children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }
  if (!roots.length) fail('no nodes');
  const total = (node) => (node.value = node.children.length ? node.children.reduce((s, c) => s + total(c), 0) : (node.own ?? 0));
  const grand = roots.reduce((s, r) => s + total(r), 0);
  if (grand <= 0) fail('values add up to zero');

  // Flatten with tree prefixes; share is of the parent (of the total for a root).
  const flat = [];
  const walk = (node, prefix, isLast, depth, parentValue) => {
    const lead = depth === 0 ? '' : prefix + (isLast ? g.treeLast : g.treeTee);
    flat.push({ text: lead + node.name, value: node.value, share: parentValue > 0 ? node.value / parentValue : 0 });
    const childPrefix = depth === 0 ? '' : prefix + (isLast ? '    ' : g.treeBar);
    node.children.forEach((c, i) => walk(c, childPrefix, i === node.children.length - 1, depth + 1, node.value));
  };
  roots.forEach((r, i) => walk(r, '', i === roots.length - 1, 0, grand));

  const nameW = Math.min(40, widest(flat.map((f) => f.text)));
  const valueText = flat.map((f) => formatValue(f.value));
  const valueW = widest(valueText);
  const shareText = flat.map((f) => `${(f.share * 100).toFixed(1)}%`);
  const shareW = widest(shareText);
  const fixed = nameW + 2 + valueW + 2 + shareW;
  if (fixed > maxWidth) fail(`needs more than ${maxWidth} columns`);
  const barW = Math.min(30, maxWidth - fixed - 2);

  const rows = [];
  if (title) rows.push(cut(title, maxWidth, g), '');
  flat.forEach((f, i) => {
    let row = `${padEnd(cut(f.text, nameW, g), nameW)}  ${padStart(valueText[i], valueW)}  ${padStart(shareText[i], shareW)}`;
    if (barW >= 6) {
      const filled = Math.round(f.share * barW);
      row += `  ${g.bar.repeat(filled)}${g.barEmpty.repeat(barW - filled)}`;
    }
    rows.push(row);
  });
  if (roots.length > 1) rows.push(`${padEnd('total', nameW)}  ${padStart(formatValue(grand), valueW)}`);
  return rows;
};
