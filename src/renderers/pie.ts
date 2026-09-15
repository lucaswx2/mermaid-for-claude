// pie (ADR-0006): one full-width bar per slice, its percentage right-aligned, `(value)` with showData.
// Subset: `pie [showData] [title ...]`, `title ...`, `showData`, `"label" : number`.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor } from '../glyphs.js';
import { cut, padEnd, padStart, RenderError, unsupportedLine, widestRow } from '../text.js';

type Slice = { label: string; value: number };

const SLICE = /^"([^"]*)"\s*:\s*(-?[0-9]*\.?[0-9]+)$/;
const LABEL_WIDTH_MAX = 32;
const BAR_WIDTH_MAX = 40;
const BAR_WIDTH_MIN = 6;

// `showData` and `title ...` may follow the header token or stand on their own line, in that order.
const parseOptions = (text: string) => {
  let rest = text.trim();
  let showData = false;
  let title: string | undefined;
  if (/^showData\b/i.test(rest)) {
    showData = true;
    rest = rest.replace(/^showData\b/i, '').trim();
  }
  if (/^title\b/i.test(rest)) {
    title = rest.replace(/^title\b/i, '').trim();
    rest = '';
  }
  return { showData, title, rest };
};

const percentText = (percent: number) => `${Number.isInteger(Math.round(percent * 10) / 10) ? Math.round(percent) : percent.toFixed(1)}%`;

export const renderPie = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  const header = parseOptions(headerLine.replace(/^pie\b/i, ''));
  if (header.rest) throw unsupportedLine(headerLine, glyphs.ellipsis);
  let showData = header.showData;
  let title = header.title ?? '';
  const slices: Slice[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    const slice = line.match(SLICE);
    if (slice) {
      slices.push({ label: slice[1] ?? '', value: Number(slice[2]) });
      continue;
    }
    const options = parseOptions(line);
    if (options.rest || (!options.showData && options.title === undefined)) throw unsupportedLine(line, glyphs.ellipsis);
    showData ||= options.showData;
    title = options.title ?? title;
  }
  if (slices.length === 0) throw new RenderError('no slices');
  if (slices.some((slice) => slice.value < 0)) throw new RenderError('negative value');
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) throw new RenderError('values add up to zero');

  const percents = slices.map((slice) => (slice.value / total) * 100);
  const percentColumn = percents.map(percentText);
  const valueColumn = slices.map((slice) => (showData ? `(${slice.value})` : ''));
  const labelWidth = Math.min(LABEL_WIDTH_MAX, widestRow(slices.map((slice) => slice.label)));
  const percentWidth = widestRow(percentColumn);
  const fixedWidth = labelWidth + 2 + 2 + percentWidth + (showData ? 1 + widestRow(valueColumn) : 0);
  const barWidth = Math.min(BAR_WIDTH_MAX, widthLimit - fixedWidth);
  if (barWidth < BAR_WIDTH_MIN) throw new RenderError(`needs more than ${widthLimit} columns`);

  const rows: string[] = [];
  if (title) rows.push(cut(title, widthLimit, glyphs.ellipsis), '');
  slices.forEach((slice, index) => {
    const filled = Math.round(((percents[index] ?? 0) / 100) * barWidth);
    const bar = glyphs.bar.repeat(filled) + glyphs.barEmpty.repeat(barWidth - filled);
    const value = showData ? ` ${valueColumn[index]}` : '';
    rows.push(`${padEnd(cut(slice.label, labelWidth, glyphs.ellipsis), labelWidth)}  ${bar}  ${padStart(percentColumn[index] ?? '', percentWidth)}${value}`);
  });
  return rows;
};
