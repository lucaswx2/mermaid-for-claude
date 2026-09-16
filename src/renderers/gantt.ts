// gantt (ADR-0007): one row per task, sections as headings, bars scaled to a time axis that spans the bar
// area, so the scale compresses to whatever the width limit leaves after the label column (at most 30% of
// the limit, titles cut with `…`). Bar glyphs by state (planned, done, active), ` crit` after the bar, one
// glyph for a milestone, a dotted column for a `vert` marker with its title under the chart, a legend for
// the states used. Subset: `title`, `dateFormat`, `axisFormat`, `tickInterval`, `excludes` / `includes`,
// `weekend`, `inclusiveEndDates`, `section`, task lines `title : [tags,] [id,] [start,] end`. Ignored:
// `todayMarker`, `topAxis`, `weekday`, `displayMode`, `click` / `href` / `call`. Dates, durations,
// `after` / `until` references and excluded days resolve as mermaid's ganttDb does.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor, type Glyphs } from '../glyphs.js';
import { codePointLength, cut, padEnd, RenderError, unsupportedLine, widestRow } from '../text.js';
import { addDuration, compileDateFormat, DAY, formatAxis, TICK_LADDER, ticksAfter, WEEKDAYS, type DateFormat, type TickStep, type TickUnit } from './gantt-time.js';

const TAGS = ['active', 'done', 'crit', 'milestone', 'vert'] as const;
type Tag = (typeof TAGS)[number];
const isTag = (text: string): text is Tag => TAGS.some((tag) => tag === text);

type TaskLine = { kind: 'task'; title: string; id: string | undefined; startText: string | undefined; endText: string; tags: Set<Tag>; inSection: boolean; line: string };
type Heading = { kind: 'heading'; name: string };
type Entry = TaskLine | Heading;

type Chart = {
  title: string;
  dateFormatText: string;
  axisFormat?: string;
  tickInterval?: TickStep;
  excludes: string[];
  includes: string[];
  weekend: 'saturday' | 'friday';
  inclusiveEndDates: boolean;
  entries: Entry[];
};

// Epoch milliseconds: `end` is what dependents see, `renderEnd` where the bar stops (mermaid's renderEndTime).
type Timing = { start: number; end: number; renderEnd: number };

const LABEL_WIDTH_MIN = 10;
const LABEL_SHARE = 0.3;
const BAR_AREA_MIN = 20;
const CRIT_WIDTH = 5;
const IGNORED_LINE = /^(todayMarker|topAxis|weekday|displayMode|click|href|call)\b/i;
const TICK_INTERVAL = /^([1-9][0-9]*)(millisecond|second|minute|hour|day|week|month)$/i;
const TICK_UNITS: Readonly<Record<string, TickUnit>> = { millisecond: 'millisecond', second: 'second', minute: 'minute', hour: 'hour', day: 'day', week: 'week', month: 'month' };
const TASK_LINE = /^(.*?)\s*:\s*(.*)$/;
const REFERENCE = /^(after|until)\s+(.+)$/i;

const wordsOf = (text: string) => text.split(/[\s,]+/).filter(Boolean).map((word) => word.toLowerCase());

// The comma list after the colon: leading tags, then `[id,] [start,] end` by count.
const parseTask = (title: string, data: string, inSection: boolean, line: string, ellipsis: string): TaskLine => {
  const fields = data.split(',').map((field) => field.trim()).filter(Boolean);
  const tags = new Set<Tag>();
  while (fields.length && isTag(fields[0] ?? '')) {
    const tag = fields.shift() ?? '';
    if (isTag(tag)) tags.add(tag);
  }
  if (fields.length < 1 || fields.length > 3) throw unsupportedLine(line, ellipsis);
  const [endText = ''] = fields.slice(-1);
  const startText = fields.length >= 2 ? fields[fields.length - 2] : undefined;
  const id = fields.length === 3 ? fields[0] : undefined;
  return { kind: 'task', title, id, startText, endText, tags, inSection, line };
};

const parseChart = (lines: string[], ellipsis: string) => {
  const chart: Chart = { title: '', dateFormatText: 'YYYY-MM-DD', excludes: [], includes: [], weekend: 'saturday', inclusiveEndDates: false, entries: [] };
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    const keyword = line.match(/^(\S+)\s*(.*)$/);
    const [, word = '', rest = ''] = keyword ?? [];
    const lower = word.toLowerCase();
    if (lower === 'title') chart.title = rest;
    else if (lower === 'dateformat') chart.dateFormatText = rest;
    else if (lower === 'axisformat') chart.axisFormat = rest;
    else if (lower === 'tickinterval') {
      const match = rest.match(TICK_INTERVAL);
      if (!match) throw unsupportedLine(line, ellipsis);
      chart.tickInterval = { unit: TICK_UNITS[(match[2] ?? '').toLowerCase()] ?? 'day', count: Number(match[1]) };
    } else if (lower === 'excludes') chart.excludes.push(...wordsOf(rest));
    else if (lower === 'includes') chart.includes.push(...wordsOf(rest));
    else if (lower === 'weekend' && /^(friday|saturday)$/i.test(rest)) chart.weekend = rest.toLowerCase() === 'friday' ? 'friday' : 'saturday';
    else if (lower === 'inclusiveenddates' && !rest) chart.inclusiveEndDates = true;
    else if (IGNORED_LINE.test(line)) continue;
    else if (lower === 'section') {
      inSection = true;
      chart.entries.push({ kind: 'heading', name: rest });
    } else {
      const task = line.match(TASK_LINE);
      if (!task || !task[1]?.trim()) throw unsupportedLine(line, ellipsis);
      chart.entries.push(parseTask(task[1].trim(), task[2] ?? '', inSection, line, ellipsis));
    }
  }
  return chart;
};

// Whether a day is excluded: `includes` wins, then `weekends` (per `weekend`), weekday names and dates
// spelled in the dateFormat or as YYYY-MM-DD, as mermaid's isInvalidDate does.
const dayExcluded = (chart: Chart, dateFormat: DateFormat, ms: number) => {
  const at = new Date(ms);
  const weekday = WEEKDAYS[at.getUTCDay()] ?? '';
  const spellings = [dateFormat.format(ms).toLowerCase(), at.toISOString().slice(0, 10)];
  if (chart.includes.includes(weekday) || spellings.some((text) => chart.includes.includes(text))) return false;
  const weekend = chart.weekend === 'friday' ? ['friday', 'saturday'] : ['saturday', 'sunday'];
  if (chart.excludes.includes('weekends') && weekend.includes(weekday)) return true;
  return chart.excludes.includes(weekday) || spellings.some((text) => chart.excludes.includes(text));
};

const EXCLUDE_ITERATIONS_MAX = 10_000;

// Excluded days extend a duration-based task day by day, from the day after its start; the bar stops
// before trailing excluded days while dependents start after them (mermaid's fixTaskDates).
const extendPastExcludedDays = (chart: Chart, dateFormat: DateFormat, start: number, end: number): Timing => {
  let extended = end;
  let renderEnd = end;
  let previousExcluded = false;
  let iterations = 0;
  for (let probe = start + DAY; probe <= extended; probe += DAY) {
    if (!previousExcluded) renderEnd = extended;
    previousExcluded = dayExcluded(chart, dateFormat, probe);
    if (previousExcluded) extended += DAY;
    if ((iterations += 1) > EXCLUDE_ITERATIONS_MAX) throw new RenderError('excludes leave no valid day');
  }
  return { start, end: extended, renderEnd };
};

// `after a b` / `until a b`: the ids named, each of which must exist.
const referencedIds = (text: string, byId: Map<string, TaskLine>) => {
  const ids = text.split(/\s+/).filter(Boolean);
  for (const id of ids) if (!byId.has(id)) throw new RenderError(`unknown id: ${id}`);
  return ids;
};

// Start and end of one task, or undefined while a reference it needs is still unresolved.
const timingOf = (chart: Chart, dateFormat: DateFormat, tasks: TaskLine[], index: number, byId: Map<string, TaskLine>, timings: Map<TaskLine, Timing>): Timing | undefined => {
  const task = tasks[index];
  if (!task) return undefined;
  let start: number;
  const startRef = task.startText?.match(REFERENCE);
  if (task.startText === undefined) {
    const previous = tasks[index - 1];
    if (!previous) throw new RenderError('first task needs a start date');
    const previousTiming = timings.get(previous);
    if (!previousTiming) return undefined;
    start = previousTiming.end;
  } else if (startRef && startRef[1]?.toLowerCase() === 'after') {
    const targets = referencedIds(startRef[2] ?? '', byId).map((id) => byId.get(id));
    const ends = targets.map((target) => (target ? timings.get(target)?.end : undefined));
    if (ends.some((end) => end === undefined)) return undefined;
    start = Math.max(...ends.map((end) => end ?? 0));
  } else {
    const parsed = dateFormat.parse(task.startText);
    if (parsed === undefined) throw new RenderError(`bad date: ${task.startText}`);
    start = parsed;
  }

  const endRef = task.endText.match(REFERENCE);
  if (endRef && endRef[1]?.toLowerCase() === 'until') {
    const targets = referencedIds(endRef[2] ?? '', byId).map((id) => byId.get(id));
    const starts = targets.map((target) => (target ? timings.get(target)?.start : undefined));
    if (starts.some((at) => at === undefined)) return undefined;
    const end = Math.min(...starts.map((at) => at ?? 0));
    return { start, end, renderEnd: end };
  }
  const explicitEnd = dateFormat.parse(task.endText);
  if (explicitEnd !== undefined) {
    const end = explicitEnd + (chart.inclusiveEndDates ? DAY : 0);
    return { start, end, renderEnd: end };
  }
  const end = addDuration(start, task.endText);
  if (end === undefined) throw new RenderError(`bad end or duration: ${task.endText}`);
  if (!chart.excludes.length) return { start, end, renderEnd: end };
  return extendPastExcludedDays(chart, dateFormat, start, end);
};

// Forward references resolve over passes; a pass that resolves nothing means a cycle.
const resolveTimings = (chart: Chart, dateFormat: DateFormat, tasks: TaskLine[], ellipsis: string) => {
  const byId = new Map<string, TaskLine>();
  for (const task of tasks) {
    if (task.id === undefined) continue;
    if (byId.has(task.id)) throw new RenderError(`duplicate id: ${task.id}`);
    byId.set(task.id, task);
  }
  const timings = new Map<TaskLine, Timing>();
  let progress = true;
  while (progress && timings.size < tasks.length) {
    progress = false;
    tasks.forEach((task, index) => {
      if (timings.has(task)) return;
      const timing = timingOf(chart, dateFormat, tasks, index, byId, timings);
      if (!timing) return;
      if (timing.end < timing.start) throw new RenderError(`task ends before it starts: ${cut(task.title, 30, ellipsis)}`);
      timings.set(task, timing);
      progress = true;
    });
  }
  const unresolved = tasks.find((task) => !timings.has(task));
  if (unresolved) throw new RenderError(`unresolved reference: ${cut(unresolved.line, 40, ellipsis)}`);
  return timings;
};

type Axis = { labelCells: string[]; ruleCells: string[] };

// Explicit tickInterval, else the first ladder step whose formatted labels do not overlap and do not repeat
// (a step finer than the label shows the same text twice); the chart start is always the first tick and a
// ladder tick whose label would overlap an earlier one is dropped, mark and all.
const buildAxis = (chart: Chart, dateFormat: DateFormat, min: number, max: number, column: (ms: number) => number, cols: number, glyphs: Glyphs): Axis => {
  const format = chart.axisFormat ?? (dateFormat.hasDate ? '%Y-%m-%d' : '%H:%M');
  const labelOf = (ms: number) => formatAxis(ms, format);
  const labelsFit = (ticks: number[]) => {
    if (ticks.length > cols) return false;
    let nextFree = -Infinity;
    let previousLabel = '';
    for (const tick of ticks) {
      const at = column(tick);
      const label = labelOf(tick);
      if (at < nextFree || label === previousLabel) return false;
      nextFree = at + codePointLength(label) + 1;
      previousLabel = label;
    }
    return true;
  };
  const step = chart.tickInterval ?? TICK_LADDER.find((candidate) => labelsFit(ticksAfter(min, max, candidate, cols + 1))) ?? TICK_LADDER[TICK_LADDER.length - 1];
  const ticks = [min, ...(step ? ticksAfter(min, max, step, cols) : [])];

  const labelCells = Array<string>(cols).fill(' ');
  const ruleCells = Array<string>(cols).fill(glyphs.horizontal);
  let nextFree = 0;
  for (const tick of ticks) {
    const at = column(tick);
    if (at >= cols || at < nextFree) continue;
    ruleCells[at] = glyphs.cross;
    const label = labelOf(tick);
    if (at + codePointLength(label) > cols) continue;
    [...label].forEach((glyph, offset) => (labelCells[at + offset] = glyph));
    nextFree = at + codePointLength(label) + 1;
  }
  return { labelCells, ruleCells };
};

type State = 'planned' | 'done' | 'active' | 'milestone';
const LEGEND: readonly { state: State; glyph: keyof Glyphs }[] = [
  { state: 'planned', glyph: 'bar' },
  { state: 'done', glyph: 'barDone' },
  { state: 'active', glyph: 'barActive' },
  { state: 'milestone', glyph: 'milestone' },
];
const LEGEND_GAP = '   ';

// Legend items three spaces apart, on as many rows as the bar area needs.
const legendRows = (items: string[], width: number) => {
  const rows: string[] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (last !== undefined && codePointLength(last) + LEGEND_GAP.length + codePointLength(item) <= width) rows[rows.length - 1] = last + LEGEND_GAP + item;
    else rows.push(item);
  }
  return rows;
};

const stateOf = (task: TaskLine): State => (task.tags.has('milestone') ? 'milestone' : task.tags.has('done') ? 'done' : task.tags.has('active') ? 'active' : 'planned');

export const renderGantt = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^gantt$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const chart = parseChart(lines, glyphs.ellipsis);
  const tasks = chart.entries.filter((entry): entry is TaskLine => entry.kind === 'task');
  if (tasks.length === 0) throw new RenderError('no tasks');
  const dateFormat = compileDateFormat(chart.dateFormatText);
  const timings = resolveTimings(chart, dateFormat, tasks, glyphs.ellipsis);
  const timingOfTask = (task: TaskLine) => timings.get(task) ?? { start: 0, end: 0, renderEnd: 0 };

  const verts = tasks.filter((task) => task.tags.has('vert'));
  const rowTasks = tasks.filter((task) => !task.tags.has('vert'));
  const min = Math.min(...tasks.map((task) => timingOfTask(task).start));
  const lastEnd = Math.max(...tasks.map((task) => timingOfTask(task).end));
  const max = lastEnd > min ? lastEnd : min + DAY;

  // Geometry: the label column, the bar area the axis spans, the crit column.
  const hasCrit = rowTasks.some((task) => task.tags.has('crit'));
  const critWidth = hasCrit ? CRIT_WIDTH : 0;
  const labelOf = (entry: Entry) => (entry.kind === 'heading' ? entry.name : entry.tags.has('vert') ? '' : `${entry.inSection ? '  ' : ''}${entry.title}`);
  const labelWidth = Math.min(widestRow(chart.entries.map(labelOf)), Math.max(LABEL_WIDTH_MIN, Math.floor(widthLimit * LABEL_SHARE)));
  const cols = widthLimit - labelWidth - 2 - critWidth;
  if (cols < BAR_AREA_MIN) throw new RenderError(`needs more than ${widthLimit} columns`);
  const msPerColumn = (max - min) / cols;
  const column = (ms: number) => Math.min(cols, Math.max(0, Math.floor((ms - min) / msPerColumn)));
  const lastColumn = (ms: number) => Math.min(cols - 1, column(ms));

  const axis = buildAxis(chart, dateFormat, min, max, column, cols, glyphs);
  const indent = ' '.repeat(labelWidth + 2);
  const vertColumns = verts.map((vert) => lastColumn(timingOfTask(vert).start));
  const withVerts = (cells: string[]) => cells.map((cell, index) => (cell === ' ' && vertColumns.includes(index) ? glyphs.vertMarker : cell));
  const labelCell = (entry: Entry) => padEnd(cut(labelOf(entry), labelWidth, glyphs.ellipsis), labelWidth) + '  ';
  const used = new Set<State>();

  const rows: string[] = [];
  if (chart.title) rows.push(cut(chart.title, widthLimit, glyphs.ellipsis), '');
  rows.push(indent + axis.labelCells.join(''), indent + withVerts(axis.ruleCells).join(''));
  for (const entry of chart.entries) {
    if (entry.kind === 'heading') {
      rows.push(labelCell(entry) + withVerts(Array<string>(cols).fill(' ')).join(''));
      continue;
    }
    if (entry.tags.has('vert')) continue;
    const timing = timingOfTask(entry);
    const state = stateOf(entry);
    used.add(state);
    const cells = Array<string>(cols).fill(' ');
    if (state === 'milestone') cells[lastColumn(timing.start + (timing.end - timing.start) / 2)] = glyphs.milestone;
    else {
      const first = lastColumn(timing.start);
      const last = Math.max(first + 1, column(timing.renderEnd));
      const glyph = glyphs[LEGEND.find((item) => item.state === state)?.glyph ?? 'bar'];
      for (let index = first; index < last; index += 1) cells[index] = glyph;
    }
    rows.push(labelCell(entry) + withVerts(cells).join('') + (entry.tags.has('crit') ? ' crit' : ''));
  }
  verts.forEach((vert, index) => {
    const at = vertColumns[index] ?? 0;
    const cells = Array<string>(cols).fill(' ');
    cells[at] = glyphs.vertMarker;
    const text = cut(vert.title, cols - 2, glyphs.ellipsis);
    const textAt = at + 2 + codePointLength(text) <= cols ? at + 2 : Math.max(0, at - 1 - codePointLength(text));
    [...text].forEach((glyph, offset) => (cells[textAt + offset] = glyph));
    rows.push(indent + cells.join(''));
  });

  const legend = LEGEND.filter((item) => used.has(item.state) && (item.state !== 'planned' || used.size > 1)).map((item) => `${glyphs[item.glyph]} ${item.state}`);
  if (legend.length) rows.push('', ...legendRows(legend, cols + critWidth).map((row) => indent + row));
  return rows;
};
