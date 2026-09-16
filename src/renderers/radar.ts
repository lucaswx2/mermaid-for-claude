// radar (ADR-0006): one row per axis, one labelled bar column per curve, no polygon; `min` and `max`
// honoured, `scale min to max` as the footer. Subset: `radar` or `radar-beta`, `title`,
// `axis id["label"], id`, `curve id["label"]{v, v}` or `{ axisId: v }`, `max`, `min`; `showLegend`,
// `graticule` and `ticks` are ignored.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor } from '../glyphs.js';
import { cut, padEnd, padStart, RenderError, unsupportedLine, widestRow } from '../text.js';

type Axis = { id: string; label: string };
type Curve = { id: string; label: string; body: string };

const NUMBER = /^-?\d+(\.\d+)?$/;
const AXIS = /^([\w-]+)(?:\s*\[\s*"([^"]*)"\s*\])?$/;
const CURVE = /^curve\s+([\w-]+)(?:\s*\[\s*"([^"]*)"\s*\])?\s*\{(.*)\}$/i;
const IGNORED = /^(showLegend|graticule|ticks)\b/i;
const LABEL_WIDTH_MAX = 24;
const BAR_WIDTH_MAX = 24;
const BAR_WIDTH_MIN = 6;

const parseRadar = (lines: string[], ellipsis: string) => {
  let title = '';
  let min = 0;
  let max: number | undefined;
  const axes: Axis[] = [];
  const curves: Curve[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const unsupported = () => unsupportedLine(line, ellipsis);
    if (/^title\b/i.test(line)) {
      title = line.replace(/^title\b/i, '').trim();
      continue;
    }
    if (/^axis\b/i.test(line)) {
      for (const part of line.replace(/^axis\b/i, '').split(',').map((piece) => piece.trim()).filter(Boolean)) {
        const axis = part.match(AXIS);
        if (!axis) throw unsupported();
        axes.push({ id: axis[1] ?? '', label: axis[2] ?? axis[1] ?? '' });
      }
      continue;
    }
    const curve = line.match(CURVE);
    if (curve) {
      curves.push({ id: curve[1] ?? '', label: curve[2] ?? curve[1] ?? '', body: curve[3] ?? '' });
      continue;
    }
    const bound = line.match(/^(max|min)\s+(-?\d+(?:\.\d+)?)$/i);
    if (bound) {
      if ((bound[1] ?? '').toLowerCase() === 'max') max = Number(bound[2]);
      else min = Number(bound[2]);
      continue;
    }
    if (IGNORED.test(line)) continue;
    throw unsupported();
  }
  if (axes.length === 0) throw new RenderError('no axes');
  if (curves.length === 0) throw new RenderError('no curves');
  return { title, min, max, axes, curves };
};

// `{v, v}` in axis order, or `{ axisId: v }` in any order; every axis needs one numeric value.
const valuesOf = (curve: Curve, axes: Axis[]) => {
  const entries = curve.body.split(',').map((entry) => entry.trim()).filter(Boolean);
  const byId = new Map(entries.map((entry) => entry.split(':').map((piece) => piece.trim())).map(([id = '', value = '']) => [id, value]));
  const texts = entries.some((entry) => entry.includes(':')) ? axes.map((axis) => byId.get(axis.id) ?? '') : entries;
  if (texts.length !== axes.length || texts.some((text) => !NUMBER.test(text))) throw new RenderError(`curve ${curve.id} needs ${axes.length} numeric values`);
  return texts.map(Number);
};

export const renderRadar = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^radar(-beta)?$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const { title, min, axes, curves, ...bounds } = parseRadar(lines, glyphs.ellipsis);
  const values = curves.map((curve) => valuesOf(curve, axes));
  const max = bounds.max ?? Math.max(...values.flat());
  if (max <= min) throw new RenderError('max must be above min');

  const labelWidth = Math.min(LABEL_WIDTH_MAX, widestRow(axes.map((axis) => axis.label)));
  const valueTexts = values.map((curveValues) => curveValues.map(String));
  const valueWidth = widestRow(valueTexts.flat());
  const count = curves.length;
  // Each curve column is bar + space + value, with two spaces between columns.
  const barWidth = Math.min(BAR_WIDTH_MAX, Math.floor((widthLimit - labelWidth - 2) / count) - (valueWidth + 3));
  if (barWidth < BAR_WIDTH_MIN) throw new RenderError(`${count} curves do not fit in ${widthLimit} columns`);
  const columnWidth = barWidth + 1 + valueWidth;
  const bar = (value: number) => {
    const filled = Math.min(barWidth, Math.max(0, Math.round(((value - min) / (max - min)) * barWidth)));
    return glyphs.bar.repeat(filled) + glyphs.barEmpty.repeat(barWidth - filled);
  };

  const rows: string[] = [];
  if (title) rows.push(cut(title, widthLimit, glyphs.ellipsis), '');
  rows.push(`${' '.repeat(labelWidth + 2)}${curves.map((curve) => padEnd(cut(curve.label, columnWidth, glyphs.ellipsis), columnWidth)).join('  ')}`);
  axes.forEach((axis, axisIndex) => {
    const cells = curves.map((_, curveIndex) => `${bar(values[curveIndex]?.[axisIndex] ?? min)} ${padStart(valueTexts[curveIndex]?.[axisIndex] ?? '', valueWidth)}`);
    rows.push(`${padEnd(cut(axis.label, labelWidth, glyphs.ellipsis), labelWidth)}  ${cells.join('  ')}`);
  });
  rows.push(`${' '.repeat(labelWidth + 2)}scale ${min} to ${max}`);
  return rows;
};
