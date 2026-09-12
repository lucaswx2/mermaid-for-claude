// PROTOTYPE - throwaway. timeline: one row per period, its events listed beside it, sections as headings.
// Subset: title, section, `period : event : event`, continuation lines starting with `:`.
import { fail, cut, padEnd, wrap, widest, len } from '../text.mjs';

export const renderTimeline = ({ header, lines, maxWidth, g }) => {
  if (!/^timeline$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  let title = '';
  const items = [];
  const events = (text) => text.split(':').map((e) => e.trim()).filter(Boolean);
  for (const raw of lines) {
    const line = raw.trim();
    if (/^title\b/i.test(line)) {
      title = line.replace(/^title\b/i, '').trim();
      continue;
    }
    if (/^section\b/i.test(line)) {
      items.push({ section: line.replace(/^section\b/i, '').trim() });
      continue;
    }
    if (line.startsWith(':')) {
      const last = items[items.length - 1];
      if (!last?.period) fail(`event without a period: ${cut(line, 40, g)}`);
      last.events.push(...events(line));
      continue;
    }
    const [period, ...rest] = line.split(':');
    if (!period.trim()) fail(`unsupported line: ${cut(line, 40, g)}`);
    items.push({ period: period.trim(), events: events(rest.join(':')) });
  }
  const periods = items.filter((i) => i.period);
  if (!periods.length) fail('no periods');

  const periodW = Math.min(24, widest(periods.map((p) => p.period)));
  const eventsW = maxWidth - (2 + periodW + 3);
  if (eventsW < 10) fail(`needs more than ${maxWidth} columns`);

  const rows = [];
  if (title) rows.push(cut(title, maxWidth, g), '');
  for (const item of items) {
    if (item.section !== undefined) {
      rows.push(cut(item.section, maxWidth, g));
      continue;
    }
    const lead = `  ${padEnd(cut(item.period, periodW, g), periodW)} ${g.v} `;
    const blank = `${' '.repeat(len(lead) - 2)}${g.v} `;
    const eventLines = item.events.flatMap((e) => wrap(e, eventsW));
    if (!eventLines.length) rows.push(lead.trimEnd());
    eventLines.forEach((line, i) => rows.push((i === 0 ? lead : blank) + line));
  }
  return rows;
};
