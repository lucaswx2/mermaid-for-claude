// timeline (ADR-0006): one row per period with its events beside it, sections as headings.
// Subset: `title`, `section`, `period : event : event`, continuation lines starting with `:`.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor } from '../glyphs.js';
import { codePointLength, cut, padEnd, RenderError, unsupportedLine, widestRow, wrap } from '../text.js';

type Entry = { kind: 'section'; name: string } | { kind: 'period'; period: string; events: string[] };

const PERIOD_WIDTH_MAX = 24;
const EVENTS_WIDTH_MIN = 10;

const eventsOf = (text: string) => text.split(':').map((event) => event.trim()).filter(Boolean);

const parseEntries = (lines: string[], ellipsis: string) => {
  let title = '';
  const entries: Entry[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^title\b/i.test(line)) {
      title = line.replace(/^title\b/i, '').trim();
      continue;
    }
    if (/^section\b/i.test(line)) {
      entries.push({ kind: 'section', name: line.replace(/^section\b/i, '').trim() });
      continue;
    }
    const last = entries[entries.length - 1];
    if (line.startsWith(':')) {
      if (last?.kind !== 'period') throw unsupportedLine(line, ellipsis);
      last.events.push(...eventsOf(line));
      continue;
    }
    const [period = '', ...rest] = line.split(':');
    if (!period.trim()) throw unsupportedLine(line, ellipsis);
    entries.push({ kind: 'period', period: period.trim(), events: eventsOf(rest.join(':')) });
  }
  return { title, entries };
};

export const renderTimeline = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^timeline$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const { title, entries } = parseEntries(lines, glyphs.ellipsis);
  const periods = entries.filter((entry) => entry.kind === 'period');
  if (periods.length === 0) throw new RenderError('no periods');

  const periodWidth = Math.min(PERIOD_WIDTH_MAX, widestRow(periods.map((entry) => entry.period)));
  const eventsWidth = widthLimit - (2 + periodWidth + 3);
  if (eventsWidth < EVENTS_WIDTH_MIN) throw new RenderError(`needs more than ${widthLimit} columns`);

  const rows: string[] = [];
  if (title) rows.push(cut(title, widthLimit, glyphs.ellipsis), '');
  for (const entry of entries) {
    if (entry.kind === 'section') {
      rows.push(cut(entry.name, widthLimit, glyphs.ellipsis));
      continue;
    }
    const lead = `  ${padEnd(cut(entry.period, periodWidth, glyphs.ellipsis), periodWidth)} ${glyphs.vertical} `;
    const continuation = `${' '.repeat(codePointLength(lead) - 2)}${glyphs.vertical} `;
    const eventRows = entry.events.flatMap((event) => wrap(event, eventsWidth));
    if (eventRows.length === 0) rows.push(lead);
    eventRows.forEach((row, index) => rows.push((index === 0 ? lead : continuation) + row));
  }
  return rows;
};
