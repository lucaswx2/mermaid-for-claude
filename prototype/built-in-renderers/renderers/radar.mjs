// PROTOTYPE - throwaway. radar: one row per axis, one labelled bar column per curve (no polygon).
// Subset: title, `axis id["label"], id`, `curve id["label"]{v, v, ...}` or `{ axisId: v, ... }`,
// `max n`, `min n`; showLegend / graticule / ticks are ignored.
import { fail, cut, padEnd, padStart, widest } from '../text.mjs';

const NUMBER = /^-?\d+(\.\d+)?$/;

export const renderRadar = ({ header, lines, maxWidth, g }) => {
  if (!/^radar(-beta)?$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  let title = '';
  const axes = [];
  const curves = [];
  let min = 0;
  let max = null;
  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^title\s+(.*)$/i))) title = m[1].trim();
    else if ((m = line.match(/^axis\s+(.*)$/i))) {
      for (const part of m[1].split(',').map((p) => p.trim()).filter(Boolean)) {
        const axis = part.match(/^([\w-]+)(?:\s*\[\s*"([^"]*)"\s*\])?$/);
        if (!axis) fail(`unsupported axis: ${cut(part, 30, g)}`);
        axes.push({ id: axis[1], label: axis[2] ?? axis[1] });
      }
    } else if ((m = line.match(/^curve\s+([\w-]+)(?:\s*\[\s*"([^"]*)"\s*\])?\s*\{(.*)\}$/i))) {
      curves.push({ id: m[1], label: m[2] ?? m[1], body: m[3] });
    } else if ((m = line.match(/^max\s+(-?[\d.]+)$/i))) max = Number(m[1]);
    else if ((m = line.match(/^min\s+(-?[\d.]+)$/i))) min = Number(m[1]);
    else if (/^(showLegend|graticule|ticks)\b/i.test(line)) continue;
    else fail(`unsupported line: ${cut(line, 40, g)}`);
  }
  if (!axes.length) fail('no axes');
  if (!curves.length) fail('no curves');

  for (const curve of curves) {
    const entries = curve.body.split(',').map((e) => e.trim()).filter(Boolean);
    if (entries.some((e) => e.includes(':'))) {
      const byId = new Map(entries.map((e) => e.split(':').map((s) => s.trim())));
      curve.values = axes.map((a) => byId.get(a.id));
    } else {
      curve.values = entries;
    }
    if (curve.values.length !== axes.length || curve.values.some((v) => !NUMBER.test(v ?? ''))) {
      fail(`curve ${curve.id} needs ${axes.length} numeric values`);
    }
    curve.values = curve.values.map(Number);
  }
  max ??= Math.max(...curves.flatMap((c) => c.values));
  if (max <= min) fail('max must be above min');

  const labelW = Math.min(24, widest(axes.map((a) => a.label)));
  const valueText = curves.map((c) => c.values.map(String));
  const valueW = widest(valueText.flat());
  const n = curves.length;
  const barW = Math.min(24, Math.floor((maxWidth - labelW - 2) / n) - (valueW + 3));
  if (barW < 6) fail(`${n} curves do not fit in ${maxWidth} columns`);
  const columnW = barW + 1 + valueW;
  const bar = (v) => {
    const filled = Math.min(barW, Math.max(0, Math.round(((v - min) / (max - min)) * barW)));
    return g.bar.repeat(filled) + g.barEmpty.repeat(barW - filled);
  };

  const rows = [];
  if (title) rows.push(cut(title, maxWidth, g), '');
  rows.push(`${' '.repeat(labelW + 2)}${curves.map((c) => padEnd(cut(c.label, columnW, g), columnW)).join('  ')}`);
  axes.forEach((axis, i) => {
    const cells = curves.map((c, k) => `${bar(c.values[i])} ${padStart(valueText[k][i], valueW)}`);
    rows.push(`${padEnd(cut(axis.label, labelW, g), labelW)}  ${cells.join('  ')}`);
  });
  rows.push(`${' '.repeat(labelW + 2)}scale ${min} to ${max}`);
  return rows;
};
