// PROTOTYPE - throwaway. pie: one labelled horizontal bar per slice, percentage at the end.
// Subset: `pie [showData] [title ...]`, `title ...`, `showData`, `"label" : number`.
import { fail, cut, padEnd, padStart, widest } from '../text.mjs';

export const renderPie = ({ header, lines, maxWidth, g }) => {
  let title = '';
  let showData = false;
  const slices = [];

  const consume = (text) => {
    let rest = text.trim();
    if (/^showData\b/i.test(rest)) {
      showData = true;
      rest = rest.replace(/^showData\b/i, '').trim();
    }
    if (/^title\b/i.test(rest)) {
      title = rest.replace(/^title\b/i, '').trim();
      rest = '';
    }
    return rest;
  };

  if (consume(header.replace(/^pie\b/i, ''))) fail(`unsupported header: ${cut(header, 40, g)}`);
  for (const raw of lines) {
    const line = raw.trim();
    const slice = line.match(/^"([^"]*)"\s*:\s*(-?[0-9]*\.?[0-9]+)$/);
    if (slice) {
      slices.push({ label: slice[1], value: Number(slice[2]) });
      continue;
    }
    if (/^(showData|title\b.*)$/i.test(line)) {
      consume(line);
      continue;
    }
    fail(`unsupported line: ${cut(line, 40, g)}`);
  }
  if (!slices.length) fail('no slices');
  if (slices.some((s) => s.value < 0)) fail('negative value');
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) fail('values add up to zero');

  const percent = slices.map((s) => (s.value / total) * 100);
  const percentText = percent.map((p) => `${Number.isInteger(Math.round(p * 10) / 10) ? Math.round(p) : p.toFixed(1)}%`);
  const valueText = slices.map((s) => (showData ? `(${s.value})` : ''));
  const labelW = Math.min(32, widest(slices.map((s) => s.label)));
  const percentW = widest(percentText);
  const valueW = widest(valueText);
  const fixed = labelW + 2 + 2 + percentW + (showData ? 1 + valueW : 0);
  const barW = Math.min(40, maxWidth - fixed);
  if (barW < 6) fail(`needs more than ${maxWidth} columns`);

  const rows = [];
  if (title) rows.push(cut(title, maxWidth, g), '');
  slices.forEach((s, i) => {
    const filled = Math.round((percent[i] / 100) * barW);
    const bar = g.bar.repeat(filled) + g.barEmpty.repeat(barW - filled);
    const value = showData ? ` ${valueText[i]}` : '';
    rows.push(`${padEnd(cut(s.label, labelW, g), labelW)}  ${bar}  ${padStart(percentText[i], percentW)}${value}`);
  });
  return rows;
};
