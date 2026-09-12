// PROTOTYPE - throwaway. gantt: one row per task, bars scaled to a time axis compressed to the width limit,
// sections as headings, milestones as a single glyph, vert markers as dotted columns. Wayfinder ticket #14.
// Subset: title, dateFormat (dayjs tokens YYYY YY MM M DD D HH H hh h A a mm m ss s X x), axisFormat (d3 subset),
// tickInterval, excludes / includes / weekend, inclusiveEndDates, section, task lines with tags
// active / done / crit / milestone / vert, ids, `after id...`, `until id...`, dates and durations (ms s m h d w M y).
// Ignored: todayMarker, topAxis, weekday, displayMode, click / href / call lines.
import { fail, cut, padEnd, len, widest, wrap } from '../text.mjs';

const DAY = 86_400_000;
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TAGS = ['active', 'done', 'crit', 'milestone', 'vert'];
const pad = (n, w = 2, c = '0') => String(n).padStart(w, c);

// --- dateFormat (input) ----------------------------------------------------------------------------------------
const DATE_TOKENS = {
  YYYY: ['(\\d{4})', (p, v) => (p.year = v)],
  YY: ['(\\d{2})', (p, v) => (p.year = 2000 + v)],
  MM: ['(\\d{2})', (p, v) => (p.month = v)],
  M: ['(\\d{1,2})', (p, v) => (p.month = v)],
  DD: ['(\\d{2})', (p, v) => (p.day = v)],
  D: ['(\\d{1,2})', (p, v) => (p.day = v)],
  HH: ['(\\d{2})', (p, v) => (p.hour = v)],
  H: ['(\\d{1,2})', (p, v) => (p.hour = v)],
  hh: ['(\\d{2})', (p, v) => (p.hour12 = v)],
  h: ['(\\d{1,2})', (p, v) => (p.hour12 = v)],
  A: ['(AM|PM)', (p, v) => (p.pm = v === 'PM')],
  a: ['(am|pm)', (p, v) => (p.pm = v === 'pm')],
  mm: ['(\\d{2})', (p, v) => (p.minute = v)],
  m: ['(\\d{1,2})', (p, v) => (p.minute = v)],
  ss: ['(\\d{2})', (p, v) => (p.second = v)],
  s: ['(\\d{1,2})', (p, v) => (p.second = v)],
  X: ['(\\d+(?:\\.\\d+)?)', (p, v) => (p.unix = v * 1000)],
  x: ['(\\d+)', (p, v) => (p.unix = v)],
};
const TOKEN_NAMES = Object.keys(DATE_TOKENS).sort((a, b) => b.length - a.length);
const UNSUPPORTED_TOKENS = ['MMMM', 'MMM', 'DDDD', 'DDD', 'Do', 'Q', 'SSS', 'SS', 'S', 'ZZ', 'Z'];

const compileDateFormat = (format) => {
  const setters = [];
  let pattern = '^';
  let rest = format;
  while (rest) {
    const unsupported = UNSUPPORTED_TOKENS.find((t) => rest.startsWith(t));
    if (unsupported) fail(`unsupported dateFormat token: ${unsupported} in ${format}`);
    const token = TOKEN_NAMES.find((t) => rest.startsWith(t));
    if (token) {
      pattern += DATE_TOKENS[token][0];
      setters.push(DATE_TOKENS[token][1]);
      rest = rest.slice(token.length);
    } else if (/^[A-Za-z]/.test(rest)) {
      fail(`unsupported dateFormat token: ${rest[0]} in ${format}`);
    } else {
      pattern += rest[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rest = rest.slice(1);
    }
  }
  const re = new RegExp(`${pattern}$`);
  const parse = (text) => {
    const m = text.trim().match(re);
    if (!m) return null;
    const p = {};
    setters.forEach((set, i) => set(p, /^[A-Za-z]/.test(m[i + 1]) ? m[i + 1] : Number(m[i + 1])));
    if (p.unix !== undefined) return p.unix;
    let hour = p.hour ?? 0;
    if (p.hour12 !== undefined) hour = (p.hour12 % 12) + (p.pm ? 12 : 0);
    return Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, hour, p.minute ?? 0, p.second ?? 0);
  };
  const hasDate = /YYYY|YY|MM|M|DD|D|X|x/.test(format);
  return { parse, hasDate };
};

// Formats a time with the dayjs tokens above (used to compare dates against excludes / includes).
const formatDateTokens = (t, format) => {
  const d = new Date(t);
  const values = {
    YYYY: pad(d.getUTCFullYear(), 4), YY: pad(d.getUTCFullYear() % 100), MM: pad(d.getUTCMonth() + 1), M: d.getUTCMonth() + 1,
    DD: pad(d.getUTCDate()), D: d.getUTCDate(), HH: pad(d.getUTCHours()), H: d.getUTCHours(),
    hh: pad(d.getUTCHours() % 12 || 12), h: d.getUTCHours() % 12 || 12, A: d.getUTCHours() < 12 ? 'AM' : 'PM', a: d.getUTCHours() < 12 ? 'am' : 'pm',
    mm: pad(d.getUTCMinutes()), m: d.getUTCMinutes(), ss: pad(d.getUTCSeconds()), s: d.getUTCSeconds(),
    X: Math.floor(t / 1000), x: t,
  };
  let out = '';
  let rest = format;
  while (rest) {
    const token = TOKEN_NAMES.find((k) => rest.startsWith(k));
    out += token ? String(values[token]) : rest[0];
    rest = rest.slice(token ? token.length : 1);
  }
  return out;
};

// --- axisFormat (output, d3-time-format subset) ---------------------------------------------------------------
const dayOfYear = (d) => Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
const weekOfYear = (d, firstDay) => {
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const offset = (jan1.getUTCDay() - firstDay + 7) % 7;
  return Math.floor((dayOfYear(d) - 1 + offset) / 7);
};
const D3 = {
  a: (d) => WEEKDAYS[d.getUTCDay()].slice(0, 3).replace(/^./, (c) => c.toUpperCase()),
  A: (d) => WEEKDAYS[d.getUTCDay()].replace(/^./, (c) => c.toUpperCase()),
  b: (d) => MONTHS[d.getUTCMonth()].slice(0, 3),
  B: (d) => MONTHS[d.getUTCMonth()],
  d: (d) => pad(d.getUTCDate()),
  e: (d) => pad(d.getUTCDate(), 2, ' '),
  H: (d) => pad(d.getUTCHours()),
  I: (d) => pad(d.getUTCHours() % 12 || 12),
  j: (d) => pad(dayOfYear(d), 3),
  m: (d) => pad(d.getUTCMonth() + 1),
  M: (d) => pad(d.getUTCMinutes()),
  L: (d) => pad(d.getUTCMilliseconds(), 3),
  p: (d) => (d.getUTCHours() < 12 ? 'AM' : 'PM'),
  S: (d) => pad(d.getUTCSeconds()),
  U: (d) => pad(weekOfYear(d, 0)),
  W: (d) => pad(weekOfYear(d, 1)),
  w: (d) => String(d.getUTCDay()),
  y: (d) => pad(d.getUTCFullYear() % 100),
  Y: (d) => String(d.getUTCFullYear()),
  Z: () => '+0000',
  '%': () => '%',
  c: (d) => formatAxis(d, '%a %b %e %H:%M:%S %Y'),
  x: (d) => formatAxis(d, '%m/%d/%Y'),
  X: (d) => formatAxis(d, '%H:%M:%S'),
};
const formatAxis = (d, format) =>
  format.replace(/%(.)/g, (_, c) => {
    if (!D3[c]) fail(`unsupported axisFormat directive: %${c}`);
    return D3[c](d);
  });

// --- durations and tick intervals -------------------------------------------------------------------------------
const addMonths = (t, months) => {
  const whole = Math.trunc(months);
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() + whole);
  return d.getTime() + (months - whole) * 30 * DAY;
};
const addDuration = (t, text) => {
  const m = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|M|y)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === 'M') return addMonths(t, n);
  if (m[2] === 'y') return addMonths(t, 12 * n);
  return t + n * UNIT_MS[m[2]];
};

const startOfDay = (t) => t - (t % DAY);
const INTERVAL_MS = { millisecond: 1, second: 1000, minute: 60_000, hour: 3_600_000, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };
const LADDER = [
  ['second', 1], ['second', 5], ['second', 15], ['second', 30], ['minute', 1], ['minute', 5], ['minute', 15], ['minute', 30],
  ['hour', 1], ['hour', 2], ['hour', 3], ['hour', 6], ['hour', 12], ['day', 1], ['day', 2], ['week', 1], ['week', 2],
  ['month', 1], ['month', 3], ['month', 6], ['year', 1],
];

const firstTick = (min, unit, n, weekday) => {
  const d = new Date(min);
  if (unit === 'year') return Date.UTC(d.getUTCFullYear(), 0, 1);
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (unit === 'week') {
    const day = startOfDay(min);
    return day - ((new Date(day).getUTCDay() - weekday + 7) % 7) * DAY;
  }
  const size = INTERVAL_MS[unit];
  return min - (min % (unit === 'day' ? DAY : size * n));
};
const nextTick = (t, unit, n) => (unit === 'year' ? addMonths(t, 12 * n) : unit === 'month' ? addMonths(t, n) : t + n * INTERVAL_MS[unit]);

// --- renderer --------------------------------------------------------------------------------------------------
export const renderGantt = ({ header, lines, maxWidth, g }) => {
  if (!/^gantt$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  let title = '';
  let dateFormatText = 'YYYY-MM-DD';
  let axisFormat = null;
  let tickInterval = null;
  let weekday = 0;
  let weekend = ['saturday', 'sunday'];
  let inclusiveEndDates = false;
  const excludes = [];
  const includes = [];
  const items = []; // { section } | task
  let section = null;
  let m;
  for (const raw of lines) {
    const line = raw.trim();
    if ((m = line.match(/^title\s+(.*)$/i))) title = m[1].trim();
    else if ((m = line.match(/^dateFormat\s+(.*)$/i))) dateFormatText = m[1].trim();
    else if ((m = line.match(/^axisFormat\s+(.*)$/i))) axisFormat = m[1].trim();
    else if ((m = line.match(/^tickInterval\s+([1-9][0-9]*)(millisecond|second|minute|hour|day|week|month)$/i))) tickInterval = [m[2].toLowerCase(), Number(m[1])];
    else if ((m = line.match(/^excludes\s+(.*)$/i))) excludes.push(...m[1].split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase()));
    else if ((m = line.match(/^includes\s+(.*)$/i))) includes.push(...m[1].split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase()));
    else if ((m = line.match(/^weekday\s+(\w+)$/i))) {
      weekday = WEEKDAYS.indexOf(m[1].toLowerCase());
      if (weekday < 0) fail(`unsupported weekday: ${m[1]}`);
    } else if ((m = line.match(/^weekend\s+(friday|saturday)$/i))) weekend = m[1].toLowerCase() === 'friday' ? ['friday', 'saturday'] : ['saturday', 'sunday'];
    else if (/^inclusiveEndDates$/i.test(line)) inclusiveEndDates = true;
    else if (/^(todayMarker|topAxis|displayMode|click|href|call)\b/i.test(line)) continue;
    else if ((m = line.match(/^section\s+(.*)$/i))) {
      section = m[1].trim();
      items.push({ heading: section });
    } else if ((m = line.match(/^(.*?)\s*:\s*(.*)$/)) && m[1].trim()) {
      const meta = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      const tags = new Set();
      while (meta.length && TAGS.includes(meta[0])) tags.add(meta.shift());
      if (meta.length < 1 || meta.length > 3) fail(`unsupported task: ${cut(line, 40, g)}`);
      const [id, startText, endText] = meta.length === 3 ? meta : meta.length === 2 ? [null, ...meta] : [null, null, meta[0]];
      items.push({ title: m[1].trim(), id, startText, endText, tags, section, line });
    } else fail(`unsupported line: ${cut(line, 40, g)}`);
  }
  const tasks = items.filter((i) => i.title);
  if (!tasks.length) fail('no tasks');
  const dateFormat = compileDateFormat(dateFormatText);
  for (const t of tasks) if (t.id && tasks.filter((o) => o.id === t.id).length > 1) fail(`duplicate task id: ${t.id}`);
  const byId = (id) => tasks.find((t) => t.id === id);
  const refs = (text, keyword) => {
    const ids = text.replace(new RegExp(`^${keyword}\\s+`, 'i'), '').split(/\s+/).filter(Boolean);
    return ids.map((id) => byId(id) ?? fail(`unknown task id: ${id}`));
  };

  // Excluded days extend duration-based tasks, day by day, as mermaid's fixTaskDates does.
  const isExcluded = (t) => {
    const name = WEEKDAYS[new Date(t).getUTCDay()];
    const text = formatDateTokens(t, dateFormatText).toLowerCase();
    if (includes.includes(name) || includes.includes(text)) return false;
    return (excludes.includes('weekends') && weekend.includes(name)) || excludes.includes(name) || excludes.includes(text);
  };
  const applyExcludes = (start, end) => {
    if (!excludes.length) return end;
    let day = startOfDay(start);
    let extended = end;
    while (day <= extended) {
      if (isExcluded(day)) extended += DAY;
      day += DAY;
    }
    return extended;
  };

  // Forward references (`until`, `after`) resolve over several passes, as mermaid's compileTasks does.
  for (let pass = 0; pass < 10 && tasks.some((t) => t.end === undefined); pass += 1) {
    tasks.forEach((task, i) => {
      if (task.end !== undefined) return;
      let start;
      if (task.startText === null) {
        const prev = tasks[i - 1];
        if (!prev) fail(`first task needs a start date: ${cut(task.line, 40, g)}`);
        if (prev.end === undefined) return;
        start = prev.end;
      } else if (/^after\s/i.test(task.startText)) {
        const targets = refs(task.startText, 'after');
        if (targets.some((t) => t.end === undefined)) return;
        start = Math.max(...targets.map((t) => t.end));
      } else {
        start = dateFormat.parse(task.startText);
        if (start === null) fail(`bad date: ${task.startText} (dateFormat ${dateFormatText})`);
      }
      let end;
      let manualEnd = false;
      if (/^until\s/i.test(task.endText)) {
        const targets = refs(task.endText, 'until');
        if (targets.some((t) => t.start === undefined)) return;
        end = Math.min(...targets.map((t) => t.start));
        manualEnd = true;
      } else if ((end = dateFormat.parse(task.endText)) !== null) {
        manualEnd = true;
        if (inclusiveEndDates) end += DAY;
      } else {
        end = addDuration(start, task.endText);
        if (end === null) fail(`bad end or duration: ${task.endText}`);
      }
      task.start = start;
      task.end = manualEnd || task.tags.has('milestone') || task.tags.has('vert') ? end : applyExcludes(start, end);
      if (task.end < task.start) fail(`task ends before it starts: ${cut(task.title, 30, g)}`);
      if (task.tags.has('milestone') || task.tags.has('vert')) task.point = task.start + (task.end - task.start) / 2;
    });
  }
  const unresolved = tasks.find((t) => t.end === undefined);
  if (unresolved) fail(`unresolved task reference: ${cut(unresolved.line, 40, g)}`);

  const verts = tasks.filter((t) => t.tags.has('vert'));
  const rowsTasks = tasks.filter((t) => !t.tags.has('vert'));
  const min = Math.min(...tasks.map((t) => (t.point ?? t.start)));
  let max = Math.max(...tasks.map((t) => (t.point ?? t.end)));
  if (max <= min) max = min + DAY;
  const span = max - min;

  // Geometry: label column, bar area, optional crit column.
  const crit = rowsTasks.some((t) => t.tags.has('crit'));
  const tagW = crit ? 5 : 0;
  const labels = items.map((i) => (i.heading !== undefined ? i.heading : i.tags.has('vert') ? '' : `${i.section ? '  ' : ''}${i.title}`));
  const labelW = Math.min(widest(labels), Math.max(10, Math.floor(maxWidth * 0.3)));
  const cols = maxWidth - labelW - 2 - tagW;
  if (cols < 20) fail(`needs more than ${maxWidth} columns`);
  const unit = span / cols;
  const col = (t) => Math.min(cols, Math.max(0, Math.floor((t - min) / unit)));

  // Axis: explicit tickInterval, else the first ladder step whose labels do not overlap.
  const format = axisFormat ?? (dateFormat.hasDate ? (span < DAY ? '%m-%d %H:%M' : '%Y-%m-%d') : '%H:%M');
  const labelLen = len(formatAxis(new Date(min), format));
  const fits = ([u, n]) => (n * INTERVAL_MS[u]) / unit >= labelLen + 1;
  const [tickUnit, tickN] = tickInterval ?? LADDER.find(fits) ?? LADDER[LADDER.length - 1];
  const ticks = [min];
  for (let t = firstTick(min, tickUnit, tickN, weekday); t <= max && ticks.length < 10_000; t = nextTick(t, tickUnit, tickN)) {
    if (t > min) ticks.push(t);
  }
  const axisLabels = Array(cols).fill(' ');
  const rule = Array(cols).fill(g.h);
  let nextFree = 0;
  for (const t of ticks) {
    const c = col(t);
    if (c >= cols) continue;
    rule[c] = g.x;
    const text = formatAxis(new Date(t), format);
    if (c >= nextFree && c + len(text) <= cols) {
      [...text].forEach((ch, i) => (axisLabels[c + i] = ch));
      nextFree = c + len(text) + 1;
    }
  }

  const indent = ' '.repeat(labelW + 2);
  const vertCols = verts.map((v) => Math.min(cols - 1, col(v.point)));
  const withVerts = (cells) => cells.map((ch, i) => (ch === ' ' && vertCols.includes(i) ? g.vert : ch));
  const barGlyph = (task) => (task.tags.has('done') ? g.barDone : task.tags.has('active') ? g.barActive : g.bar);
  const used = new Set();

  const rows = [];
  if (title) rows.push(cut(title, maxWidth, g), '');
  rows.push(indent + axisLabels.join(''));
  rows.push(indent + withVerts(rule).join(''));
  items.forEach((item, i) => {
    if (item.heading !== undefined) {
      rows.push(padEnd(cut(item.heading, labelW, g), labelW) + '  ' + withVerts(Array(cols).fill(' ')).join(''));
      return;
    }
    if (item.tags.has('vert')) return;
    const cells = Array(cols).fill(' ');
    if (item.tags.has('milestone')) {
      cells[Math.min(cols - 1, col(item.point))] = g.milestone;
      used.add('milestone');
    } else {
      const s = Math.min(cols - 1, col(item.start));
      const e = Math.max(s + 1, col(item.end));
      const glyph = barGlyph(item);
      used.add(glyph === g.bar ? 'planned' : item.tags.has('done') ? 'done' : 'active');
      for (let c = s; c < e; c += 1) cells[c] = glyph;
    }
    const tag = item.tags.has('crit') ? ' crit' : '';
    rows.push(padEnd(cut(labels[i], labelW, g), labelW) + '  ' + withVerts(cells).join('') + tag);
  });
  verts.forEach((v, k) => {
    const cells = Array(cols).fill(' ');
    cells[vertCols[k]] = g.vert;
    const text = cut(v.title, cols - 2, g);
    const at = vertCols[k] + 2 + len(text) <= cols ? vertCols[k] + 2 : vertCols[k] - 1 - len(text);
    [...text].forEach((ch, i) => (cells[at + i] = ch));
    rows.push(indent + cells.join(''));
  });
  const legend = [
    used.has('planned') && used.size > 1 && `${g.bar} planned`,
    used.has('done') && `${g.barDone} done`,
    used.has('active') && `${g.barActive} active`,
    used.has('milestone') && `${g.milestone} milestone`,
  ].filter(Boolean);
  if (legend.length) rows.push('', ...wrap(legend.join('   '), cols + tagW).map((l) => indent + l));
  return rows;
};
