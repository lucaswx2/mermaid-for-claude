// gitGraph (ADR-0006): git-log lanes top to bottom, one row per commit, the id, `[tag]`, `merge x`,
// `branch x` and `cherry-pick x` labels on the right; the direction is accepted and ignored, auto ids are
// not printed, a lane ends after its last commit, the last merge taken from it or the fork of its last
// child. Subset: `gitGraph [LR:|TB:|BT:]`, `commit [id:] [tag:] [type: NORMAL|REVERSE|HIGHLIGHT]`,
// `branch <name> [order:]`, `checkout|switch <name>`, `merge <name> [id:] [tag:] [type:]`,
// `cherry-pick id: [parent:] [tag:]`.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor, type Glyphs } from '../glyphs.js';
import { codePointLength, cut, RenderError, unsupportedLine, widestRow } from '../text.js';

type Lane = { name: string; order: number | undefined; created: number; parent: Lane | undefined; x: number };
type Commit = { lane: Lane; glyph: string; label: string; from: Lane | undefined };
type Options = Record<string, string>;

const MAIN = 'main';
const HEADER = /^gitGraph(\s+(LR|TB|BT):?)?$/i;
const OPTION = /([\w-]+)\s*:\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
const COMMIT_TYPES = ['NORMAL', 'REVERSE', 'HIGHLIGHT'];
const LABEL_WIDTH_MIN = 8;

// `key: value` pairs, quoted or bare; undefined when text is left over or a key is outside `allowed`.
const parseOptions = (text: string, allowed: readonly string[]) => {
  const options: Options = {};
  for (const match of text.matchAll(OPTION)) {
    const key = match[1] ?? '';
    if (!allowed.includes(key)) return undefined;
    options[key] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  if (text.replace(OPTION, '').trim()) return undefined;
  return options;
};

const commitGlyph = (glyphs: Glyphs, type: string | undefined) => {
  if (type === undefined) return glyphs.commit;
  const upper = type.toUpperCase();
  if (!COMMIT_TYPES.includes(upper)) return undefined;
  return upper === 'HIGHLIGHT' ? glyphs.commitHighlight : upper === 'REVERSE' ? glyphs.commitReverse : glyphs.commit;
};

const labelOf = (options: Options, prefix?: string) => [prefix, options['id'], options['tag'] && `[${options['tag']}]`].filter(Boolean).join(' ');

const parseGraph = (lines: string[], glyphs: Glyphs) => {
  const main: Lane = { name: MAIN, order: undefined, created: 0, parent: undefined, x: 0 };
  const lanes = [main];
  const laneByName = new Map([[MAIN, main]]);
  const commits: Commit[] = [];
  let current = main;

  for (const raw of lines) {
    const line = raw.trim();
    const [, keyword = '', rest = ''] = line.match(/^(\S+)\s*(.*)$/) ?? [];
    const unsupported = () => unsupportedLine(line, glyphs.ellipsis);
    switch (keyword.toLowerCase()) {
      case 'commit': {
        const options = parseOptions(rest, ['id', 'tag', 'type']);
        const glyph = options && commitGlyph(glyphs, options['type']);
        if (!options || !glyph) throw unsupported();
        commits.push({ lane: current, glyph, label: labelOf(options), from: undefined });
        break;
      }
      case 'branch': {
        const [name = '', ...optionParts] = rest.split(/\s+/);
        const options = parseOptions(optionParts.join(' '), ['order']);
        if (!name || !options || (options['order'] !== undefined && !/^-?\d+$/.test(options['order']))) throw unsupported();
        if (laneByName.has(name)) throw new RenderError(`branch ${name} already exists`);
        const order = options['order'] === undefined ? undefined : Number(options['order']);
        const lane: Lane = { name, order, created: lanes.length, parent: current, x: 0 };
        lanes.push(lane);
        laneByName.set(name, lane);
        current = lane;
        break;
      }
      case 'checkout':
      case 'switch': {
        const lane = laneByName.get(rest.trim());
        if (!lane) throw new RenderError(`unknown branch ${cut(rest.trim(), 24, glyphs.ellipsis)}`);
        current = lane;
        break;
      }
      case 'merge': {
        const [name = '', ...optionParts] = rest.split(/\s+/);
        const options = parseOptions(optionParts.join(' '), ['id', 'tag', 'type']);
        if (!name || !options || (options['type'] !== undefined && !commitGlyph(glyphs, options['type']))) throw unsupported();
        const from = laneByName.get(name);
        if (!from) throw new RenderError(`unknown branch ${cut(name, 24, glyphs.ellipsis)}`);
        if (from === current) throw new RenderError(`cannot merge ${name} into itself`);
        commits.push({ lane: current, glyph: glyphs.commitMerge, label: labelOf(options, `merge ${name}`), from });
        break;
      }
      case 'cherry-pick': {
        const options = parseOptions(rest, ['id', 'parent', 'tag']);
        if (!options || options['id'] === undefined) throw unsupported();
        commits.push({ lane: current, glyph: glyphs.commit, label: labelOf({ tag: options['tag'] ?? '' }, `cherry-pick ${options['id']}`), from: undefined });
        break;
      }
      default:
        throw unsupported();
    }
  }
  if (commits.length === 0) throw new RenderError('no commits');
  return { main, lanes, commits };
};

// The row index of each lane's last use: its last commit, the last merge taken from it, or the fork of
// its last child. Main never closes.
const lastUseOf = (lanes: Lane[], commits: Commit[]) => {
  const firstCommit = new Map<Lane, number>();
  const lastUse = new Map<Lane, number>();
  const extend = (lane: Lane, index: number) => lastUse.set(lane, Math.max(lastUse.get(lane) ?? -1, index));
  commits.forEach((commit, index) => {
    if (!firstCommit.has(commit.lane)) firstCommit.set(commit.lane, index);
    extend(commit.lane, index);
    if (commit.from) extend(commit.from, index);
  });
  for (const lane of lanes) {
    const first = firstCommit.get(lane);
    if (lane.parent && first !== undefined) extend(lane.parent, first);
  }
  return lastUse;
};

export const renderGitGraph = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!HEADER.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const { main, lanes, commits } = parseGraph(lines, glyphs);

  // Lane columns: explicit `order:` first, then creation order.
  const ordered = [...lanes].sort((a, b) => (a.order ?? a.created) - (b.order ?? b.created) || a.created - b.created);
  ordered.forEach((lane, index) => (lane.x = 2 * index));
  const lastUse = lastUseOf(lanes, commits);

  const cellsWidth = 2 * ordered.length - 1;
  const labelX = cellsWidth + 2;
  const labelWidth = widthLimit - labelX;
  if (labelWidth < LABEL_WIDTH_MIN) throw new RenderError(`${ordered.length} branches do not fit in ${widthLimit} columns`);

  const active = new Set([main]);
  const rows: string[] = [];
  const emit = (cells: string[], label: string) => {
    const text = cells.join('');
    rows.push(label ? `${text}${' '.repeat(labelX - codePointLength(text))}${cut(label, labelWidth, glyphs.ellipsis)}` : text);
  };
  const blankCells = () => {
    const cells: string[] = Array.from({ length: cellsWidth }, () => ' ');
    for (const lane of active) cells[lane.x] = glyphs.vertical;
    return cells;
  };
  // The horizontal run between two lanes on one row; the caller sets both endpoints.
  const connect = (cells: string[], a: Lane, b: Lane) => {
    const [left, right] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
    for (let x = left + 1; x < right; x += 1) cells[x] = cells[x] === glyphs.vertical ? glyphs.cross : glyphs.horizontal;
  };

  rows.push(`${' '.repeat(main.x)}${MAIN}`);
  commits.forEach((commit, index) => {
    const { lane } = commit;
    if (!active.has(lane) && lane.parent) {
      const { parent } = lane;
      active.add(parent);
      const cells = blankCells();
      connect(cells, parent, lane);
      cells[parent.x] = parent.x < lane.x ? glyphs.teeRight : glyphs.teeLeft;
      cells[lane.x] = parent.x < lane.x ? glyphs.topRight : glyphs.topLeft;
      emit(cells, `branch ${lane.name}`);
      active.add(lane);
    }
    const cells = blankCells();
    if (commit.from) {
      const { from } = commit;
      if (!active.has(from)) throw new RenderError(`branch ${from.name} has no commits to merge`);
      connect(cells, from, lane);
      const fromEnds = lastUse.get(from) === index && from !== main;
      if (from.x < lane.x) cells[from.x] = fromEnds ? glyphs.bottomLeft : glyphs.teeRight;
      else cells[from.x] = fromEnds ? glyphs.bottomRight : glyphs.teeLeft;
    }
    cells[lane.x] = commit.glyph;
    emit(cells, commit.label);
    for (const open of [...active]) {
      if (open !== main && lastUse.get(open) === index) active.delete(open);
    }
  });
  if (widestRow(rows) > widthLimit) throw new RenderError(`needs more than ${widthLimit} columns`);
  return rows;
};
