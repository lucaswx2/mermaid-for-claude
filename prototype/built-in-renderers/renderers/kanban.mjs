// PROTOTYPE - throwaway. kanban: side-by-side boxed columns, labels word-wrapped to the column width,
// metadata (ticket, assigned, priority) on a line under the item.
// Subset: column = first indentation level, item = deeper level, `id[label]`, `[label]`, plain text,
// optional `@{ key: value, ... }` after an item.
import { fail, cut, padEnd, wrap, widest } from '../text.mjs';

const parseNode = (line) => {
  const boxed = line.match(/^(?:[\w-]+)?\s*\[(.*)\]\s*(?:@\{(.*)\})?\s*$/);
  const text = boxed ? boxed[1] : line.replace(/@\{.*\}\s*$/, '').trim();
  const metaText = boxed ? boxed[2] : line.match(/@\{(.*)\}\s*$/)?.[1];
  const meta = {};
  for (const m of (metaText ?? '').matchAll(/([\w-]+)\s*:\s*('([^']*)'|"([^"]*)"|([^,}]+))/g)) meta[m[1]] = (m[3] ?? m[4] ?? m[5]).trim();
  return { text: text.replace(/^"(.*)"$/, '$1'), meta };
};

const metaLine = (meta) => [meta.ticket && `#${meta.ticket}`, meta.assigned, meta.priority].filter(Boolean).join('  ');

export const renderKanban = ({ header, lines, maxWidth, g }) => {
  if (!/^kanban$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  const columns = [];
  let columnIndent = null;
  for (const raw of lines) {
    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const node = parseNode(raw.trim());
    if (!node.text) fail(`empty node: ${cut(raw.trim(), 40, g)}`);
    if (columnIndent === null) columnIndent = indent;
    if (indent <= columnIndent) {
      columns.push({ title: node.text, items: [] });
      continue;
    }
    if (!columns.length) fail('item before any column');
    columns[columns.length - 1].items.push(node);
  }
  if (!columns.length) fail('no columns');

  const n = columns.length;
  const inner = Math.min(28, Math.floor((maxWidth - 1) / n) - 3);
  if (inner < 10) fail(`${n} columns do not fit in ${maxWidth} columns`);

  const titles = columns.map((c) => wrap(c.title, inner));
  const bodies = columns.map((c) =>
    c.items.flatMap((item, i) => {
      const lines = wrap(item.text, inner);
      const meta = metaLine(item.meta);
      if (meta) lines.push(...wrap(meta, inner - 2).map((l) => `  ${l}`));
      return i === 0 ? lines : ['', ...lines];
    }),
  );
  const titleH = Math.max(1, ...titles.map((t) => t.length));
  const bodyH = Math.max(1, ...bodies.map((b) => b.length));

  const row = (cells) => `${g.v} ${cells.map((c) => padEnd(c, inner)).join(` ${g.v} `)} ${g.v}`;
  const rule = (left, mid, right) => `${left}${columns.map(() => g.h.repeat(inner + 2)).join(mid)}${right}`;
  const rows = [rule(g.tl, g.tj, g.tr)];
  for (let i = 0; i < titleH; i += 1) rows.push(row(titles.map((t) => t[i] ?? '')));
  rows.push(rule(g.lj, g.x, g.rj));
  for (let i = 0; i < bodyH; i += 1) rows.push(row(bodies.map((b) => b[i] ?? '')));
  rows.push(rule(g.bl, g.bj, g.br));
  return rows;
};
