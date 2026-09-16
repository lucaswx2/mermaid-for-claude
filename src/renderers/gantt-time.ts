// Time helpers for the gantt renderer (ADR-0007): the dayjs `dateFormat` tokens mermaid parses task dates
// with, the d3 `axisFormat` directives it labels the axis with, durations as dayjs adds them, and the tick
// ladder. Everything is UTC arithmetic on epoch milliseconds, so the output never depends on the machine's
// time zone; mermaid works in the browser's local time, which shows the same digits.
import { RenderError } from '../text.js';

export const DAY = 86_400_000;
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const zeroPad = (value: number, width = 2) => String(value).padStart(width, '0');
const capitalized = (word: string) => word.replace(/^./, (letter) => letter.toUpperCase());

// --- dateFormat: dayjs tokens -------------------------------------------------------------------------

type DateParts = { year?: number; month?: number; day?: number; hour?: number; hour12?: number; pm?: boolean; minute?: number; second?: number; unix?: number };
type DateToken = { pattern: string; date: boolean; set: (parts: DateParts, text: string) => void; format: (at: Date, ms: number) => string };

const hour12Of = (at: Date) => at.getUTCHours() % 12 || 12;
type NumericPart = Exclude<keyof DateParts, 'pm'>;
const numeric = (pattern: string, date: boolean, key: NumericPart, format: DateToken['format']): DateToken => ({
  pattern,
  date,
  set: (parts, text) => {
    parts[key] = Number(text);
  },
  format,
});

const DATE_TOKENS: Readonly<Record<string, DateToken>> = {
  YYYY: numeric('\\d{4}', true, 'year', (at) => zeroPad(at.getUTCFullYear(), 4)),
  YY: { pattern: '\\d{2}', date: true, set: (parts, text) => (parts.year = 2000 + Number(text)), format: (at) => zeroPad(at.getUTCFullYear() % 100) },
  MM: numeric('\\d{2}', true, 'month', (at) => zeroPad(at.getUTCMonth() + 1)),
  M: numeric('\\d{1,2}', true, 'month', (at) => String(at.getUTCMonth() + 1)),
  DD: numeric('\\d{2}', true, 'day', (at) => zeroPad(at.getUTCDate())),
  D: numeric('\\d{1,2}', true, 'day', (at) => String(at.getUTCDate())),
  HH: numeric('\\d{2}', false, 'hour', (at) => zeroPad(at.getUTCHours())),
  H: numeric('\\d{1,2}', false, 'hour', (at) => String(at.getUTCHours())),
  hh: numeric('\\d{2}', false, 'hour12', (at) => zeroPad(hour12Of(at))),
  h: numeric('\\d{1,2}', false, 'hour12', (at) => String(hour12Of(at))),
  A: { pattern: 'AM|PM', date: false, set: (parts, text) => (parts.pm = text === 'PM'), format: (at) => (at.getUTCHours() < 12 ? 'AM' : 'PM') },
  a: { pattern: 'am|pm', date: false, set: (parts, text) => (parts.pm = text === 'pm'), format: (at) => (at.getUTCHours() < 12 ? 'am' : 'pm') },
  mm: numeric('\\d{2}', false, 'minute', (at) => zeroPad(at.getUTCMinutes())),
  m: numeric('\\d{1,2}', false, 'minute', (at) => String(at.getUTCMinutes())),
  ss: numeric('\\d{2}', false, 'second', (at) => zeroPad(at.getUTCSeconds())),
  s: numeric('\\d{1,2}', false, 'second', (at) => String(at.getUTCSeconds())),
  X: { pattern: '\\d+(?:\\.\\d+)?', date: true, set: (parts, text) => (parts.unix = Number(text) * 1000), format: (_at, ms) => String(Math.floor(ms / 1000)) },
  x: { pattern: '\\d+', date: true, set: (parts, text) => (parts.unix = Number(text)), format: (_at, ms) => String(ms) },
};
const DATE_TOKEN_NAMES = Object.keys(DATE_TOKENS).sort((a, b) => b.length - a.length);
const UNSUPPORTED_DATE_TOKENS = ['MMMM', 'MMM', 'DDDD', 'DDD', 'Do', 'Q', 'SSS', 'SS', 'S', 'ZZ', 'Z'];

type FormatPiece = { kind: 'token'; name: string } | { kind: 'literal'; text: string };

const piecesOf = (format: string) => {
  const pieces: FormatPiece[] = [];
  let rest = format;
  while (rest) {
    const unsupported = UNSUPPORTED_DATE_TOKENS.find((token) => rest.startsWith(token));
    if (unsupported) throw new RenderError(`unsupported dateFormat token: ${unsupported}`);
    const name = DATE_TOKEN_NAMES.find((token) => rest.startsWith(token));
    if (name) {
      pieces.push({ kind: 'token', name });
      rest = rest.slice(name.length);
      continue;
    }
    if (/^[A-Za-z]/.test(rest)) throw new RenderError(`unsupported dateFormat token: ${rest[0]}`);
    pieces.push({ kind: 'literal', text: rest[0] ?? '' });
    rest = rest.slice(1);
  }
  return pieces;
};

const inRange = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;

// Epoch milliseconds for the parts, or undefined when a part is out of range (a 13th month, a 31 April).
const millisOf = (parts: DateParts) => {
  if (parts.unix !== undefined) return parts.unix;
  const year = parts.year ?? 1970;
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  let hour = parts.hour ?? 0;
  if (parts.hour12 !== undefined) hour = (parts.hour12 % 12) + (parts.pm ? 12 : 0);
  const minute = parts.minute ?? 0;
  const second = parts.second ?? 0;
  if (!inRange(month, 1, 12) || !inRange(day, 1, 31) || !inRange(hour, 0, 23) || !inRange(minute, 0, 59) || !inRange(second, 0, 59)) return undefined;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(ms).getUTCDate() === day ? ms : undefined;
};

export type DateFormat = {
  // Epoch milliseconds, or undefined when the text does not match the format exactly (dayjs strict mode).
  parse: (text: string) => number | undefined;
  // The same tokens applied to a time, as mermaid compares dates against `excludes` / `includes`.
  format: (ms: number) => string;
  // Whether the format names a day at all; a time-only format gets the `%H:%M` axis.
  hasDate: boolean;
};

export const compileDateFormat = (format: string): DateFormat => {
  const pieces = piecesOf(format);
  const tokens = pieces.flatMap((piece) => (piece.kind === 'token' ? [DATE_TOKENS[piece.name]] : [])).filter((token): token is DateToken => token !== undefined);
  const pattern = pieces.map((piece) => (piece.kind === 'token' ? `(${DATE_TOKENS[piece.name]?.pattern ?? ''})` : piece.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
  const matcher = new RegExp(`^${pattern}$`);
  return {
    parse: (text) => {
      const match = text.trim().match(matcher);
      if (!match) return undefined;
      const parts: DateParts = {};
      tokens.forEach((token, index) => token.set(parts, match[index + 1] ?? ''));
      return millisOf(parts);
    },
    format: (ms) => {
      const at = new Date(ms);
      return pieces.map((piece) => (piece.kind === 'token' ? (DATE_TOKENS[piece.name]?.format(at, ms) ?? '') : piece.text)).join('');
    },
    hasDate: tokens.some((token) => token.date),
  };
};

// --- axisFormat: d3-time-format directives ------------------------------------------------------------

const startOfYear = (at: Date) => Date.UTC(at.getUTCFullYear(), 0, 1);
const dayOfYear = (at: Date) => Math.floor((at.getTime() - startOfYear(at)) / DAY);
// d3 %U / %W: the number of Sundays (Mondays) between the last day of the previous year and the date.
const weekOfYear = (at: Date, firstWeekday: number) => Math.floor((dayOfYear(at) + 7 - ((at.getUTCDay() - firstWeekday + 7) % 7)) / 7);

// Each directive gives the value and the width and pad character d3 uses for it (`%-d`, `%_d`, `%0d` override).
type AxisDirective = (at: Date) => { text: string; pad?: string; width?: number };
const number = (value: number, width = 2, pad = '0'): ReturnType<AxisDirective> => ({ text: String(value), width, pad });
const AXIS_DIRECTIVES: Readonly<Record<string, AxisDirective>> = {
  a: (at) => ({ text: capitalized(WEEKDAYS[at.getUTCDay()] ?? '').slice(0, 3) }),
  A: (at) => ({ text: capitalized(WEEKDAYS[at.getUTCDay()] ?? '') }),
  b: (at) => ({ text: (MONTHS[at.getUTCMonth()] ?? '').slice(0, 3) }),
  B: (at) => ({ text: MONTHS[at.getUTCMonth()] ?? '' }),
  d: (at) => number(at.getUTCDate()),
  e: (at) => number(at.getUTCDate(), 2, ' '),
  H: (at) => number(at.getUTCHours()),
  I: (at) => number(hour12Of(at)),
  j: (at) => number(dayOfYear(at) + 1, 3),
  m: (at) => number(at.getUTCMonth() + 1),
  M: (at) => number(at.getUTCMinutes()),
  L: (at) => number(at.getUTCMilliseconds(), 3),
  p: (at) => ({ text: at.getUTCHours() < 12 ? 'AM' : 'PM' }),
  S: (at) => number(at.getUTCSeconds()),
  U: (at) => number(weekOfYear(at, 0)),
  W: (at) => number(weekOfYear(at, 1)),
  w: (at) => ({ text: String(at.getUTCDay()) }),
  y: (at) => number(at.getUTCFullYear() % 100),
  Y: (at) => ({ text: String(at.getUTCFullYear()) }),
  Z: () => ({ text: '+0000' }),
  '%': () => ({ text: '%' }),
  // d3's default locale: `%c` is "%x, %X", `%x` is "%-m/%-d/%Y", `%X` is "%-I:%M:%S %p".
  c: (at) => ({ text: formatAxis(at.getTime(), '%-m/%-d/%Y, %-I:%M:%S %p') }),
  x: (at) => ({ text: formatAxis(at.getTime(), '%-m/%-d/%Y') }),
  X: (at) => ({ text: formatAxis(at.getTime(), '%-I:%M:%S %p') }),
};
const PAD_MODIFIERS: Readonly<Record<string, string | undefined>> = { '-': undefined, _: ' ', '0': '0' };

export const formatAxis = (ms: number, format: string) => {
  const at = new Date(ms);
  return format.replace(/%([-_0]?)(.)/g, (_match, modifier: string, letter: string) => {
    const directive = AXIS_DIRECTIVES[letter];
    if (!directive) throw new RenderError(`unsupported axisFormat directive: %${letter}`);
    const { text, width, pad } = directive(at);
    const padWith = modifier ? PAD_MODIFIERS[modifier] : pad;
    return padWith === undefined || width === undefined ? text : text.padStart(width, padWith);
  });
};

// --- durations and tick intervals --------------------------------------------------------------------

export const addMonths = (ms: number, months: number) => {
  const at = new Date(ms);
  at.setUTCMonth(at.getUTCMonth() + months);
  return at.getTime();
};

const EXACT_UNIT_MS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|M|y)$/;

// Start plus a mermaid duration, added as dayjs does: days and weeks round to whole days, months and years
// truncate to whole months, the rest is exact.
export const addDuration = (ms: number, text: string) => {
  const match = text.match(DURATION);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] ?? '';
  if (unit === 'd') return ms + Math.round(amount) * DAY;
  if (unit === 'w') return ms + Math.round(amount * 7) * DAY;
  if (unit === 'M') return addMonths(ms, Math.trunc(amount));
  if (unit === 'y') return addMonths(ms, Math.trunc(amount) * 12);
  return ms + amount * (EXACT_UNIT_MS[unit] ?? 0);
};

export type TickUnit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
export type TickStep = { unit: TickUnit; count: number };

const FIXED_UNIT_MS: Readonly<Partial<Record<TickUnit, number>>> = { millisecond: 1, second: 1000, minute: 60_000, hour: 3_600_000, day: DAY, week: 7 * DAY };
const step = (unit: TickUnit, count: number): TickStep => ({ unit, count });

// From 1 second to 1 year; the axis takes the first step whose labels do not overlap.
export const TICK_LADDER: readonly TickStep[] = [
  step('second', 1), step('second', 5), step('second', 15), step('second', 30),
  step('minute', 1), step('minute', 5), step('minute', 15), step('minute', 30),
  step('hour', 1), step('hour', 2), step('hour', 3), step('hour', 6), step('hour', 12),
  step('day', 1), step('day', 2), step('week', 1), step('week', 2),
  step('month', 1), step('month', 3), step('month', 6), step('year', 1),
];

// The first tick on or before `from`: a calendar boundary for months and years, a Sunday for weeks (the
// `weekday` line is ignored), else a multiple of the step counted from the epoch.
const firstTickOnOrBefore = (from: number, { unit, count }: TickStep) => {
  const at = new Date(from);
  if (unit === 'year') return startOfYear(at);
  if (unit === 'month') return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
  const size = FIXED_UNIT_MS[unit] ?? 1;
  if (unit === 'week') {
    const day = from - (from % DAY);
    return day - new Date(day).getUTCDay() * DAY;
  }
  return from - (from % (count * size));
};

const nextTick = (ms: number, { unit, count }: TickStep) => {
  if (unit === 'year') return addMonths(ms, 12 * count);
  if (unit === 'month') return addMonths(ms, count);
  return ms + count * (FIXED_UNIT_MS[unit] ?? 1);
};

// The ticks after `from` up to `to`, at most `limit` of them (a step finer than the columns stops early).
export const ticksAfter = (from: number, to: number, tickStep: TickStep, limit: number) => {
  const ticks: number[] = [];
  for (let tick = firstTickOnOrBefore(from, tickStep); tick <= to && ticks.length < limit; tick = nextTick(tick, tickStep)) {
    if (tick > from) ticks.push(tick);
  }
  return ticks;
};
