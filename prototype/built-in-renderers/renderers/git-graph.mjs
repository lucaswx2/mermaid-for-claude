// PROTOTYPE - throwaway. gitGraph: git-log style lanes, one row per commit, top to bottom
// (the LR/TB/BT direction is accepted and ignored). Labels (id, tags, merge/branch names) on the right.
// Subset: commit [id:] [tag:] [type:], branch <name> [order:], checkout|switch <name>,
// merge <name> [id:] [tag:] [type:], cherry-pick id: [parent:] [tag:].
import { fail, cut, widest } from '../text.mjs';

const MAIN = 'main';

const parseOptions = (text) => {
  const options = {};
  for (const m of text.matchAll(/([\w-]+)\s*:\s*("([^"]*)"|'([^']*)'|(\S+))/g)) options[m[1]] = m[3] ?? m[4] ?? m[5];
  return options;
};

export const renderGitGraph = ({ header, lines, maxWidth, g }) => {
  if (!/^gitGraph(\s+(LR|TB|BT):?)?$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);

  const lanes = [{ name: MAIN, order: 0, created: 0, parent: null }];
  const laneByName = new Map([[MAIN, lanes[0]]]);
  const commits = [];
  let current = lanes[0];

  const glyphOf = (o) => (o.type === 'HIGHLIGHT' ? g.highlight : o.type === 'REVERSE' ? g.reverse : g.commit);
  const labelOf = (o, prefix = []) => [...prefix, o.id, o.tag && `[${o.tag}]`].filter(Boolean).join(' ');

  for (const raw of lines) {
    const line = raw.trim();
    const [, keyword, rest = ''] = line.match(/^(\S+)\s*(.*)$/) ?? [];
    switch ((keyword ?? '').toLowerCase()) {
      case 'commit': {
        const o = parseOptions(rest);
        commits.push({ lane: current, glyph: glyphOf(o), label: labelOf(o) });
        break;
      }
      case 'branch': {
        const [name, ...optionParts] = rest.split(/\s+/);
        if (!name) fail('branch without a name');
        if (laneByName.has(name)) fail(`branch ${name} already exists`);
        const o = parseOptions(optionParts.join(' '));
        const lane = { name, order: o.order == null ? null : Number(o.order), created: lanes.length, parent: current };
        lanes.push(lane);
        laneByName.set(name, lane);
        current = lane;
        break;
      }
      case 'checkout':
      case 'switch': {
        const lane = laneByName.get(rest.trim());
        if (!lane) fail(`unknown branch ${cut(rest.trim(), 24, g)}`);
        current = lane;
        break;
      }
      case 'merge': {
        const [name, ...optionParts] = rest.split(/\s+/);
        const from = laneByName.get(name ?? '');
        if (!from) fail(`unknown branch ${cut(name ?? '', 24, g)}`);
        if (from === current) fail(`cannot merge ${name} into itself`);
        const o = parseOptions(optionParts.join(' '));
        commits.push({ lane: current, glyph: g.merge, label: labelOf(o, [`merge ${name}`]), from });
        break;
      }
      case 'cherry-pick': {
        const o = parseOptions(rest);
        commits.push({ lane: current, glyph: g.commit, label: labelOf({ tag: o.tag }, [`cherry-pick ${o.id ?? ''}`.trim()]) });
        break;
      }
      default:
        fail(`unsupported line: ${cut(line, 40, g)}`);
    }
  }
  if (!commits.length) fail('no commits');

  // Lane order: explicit `order:` first, then creation order; main is 0.
  const ordered = [...lanes].sort((a, b) => (a.order ?? a.created) - (b.order ?? b.created) || a.created - b.created);
  ordered.forEach((lane, i) => (lane.x = 2 * i));

  // A lane is open from the connector before its first commit until its last use:
  // its last commit, the last merge taken from it, or the fork of its last child.
  const firstCommit = new Map();
  const lastUse = new Map([[lanes[0], commits.length - 1]]);
  commits.forEach((c, i) => {
    if (!firstCommit.has(c.lane)) firstCommit.set(c.lane, i);
    lastUse.set(c.lane, i);
    if (c.from) lastUse.set(c.from, Math.max(lastUse.get(c.from) ?? -1, i));
  });
  for (const lane of lanes) {
    if (lane.parent && firstCommit.has(lane)) {
      lastUse.set(lane.parent, Math.max(lastUse.get(lane.parent) ?? -1, firstCommit.get(lane)));
    }
  }

  const laneCount = ordered.length;
  const cellsWidth = 2 * laneCount - 1;
  const labelX = cellsWidth + 2;
  const labelW = maxWidth - labelX;
  if (labelW < 8) fail(`${laneCount} branches do not fit in ${maxWidth} columns`);

  const active = new Set([lanes[0]]);
  const rows = [];
  const emit = (cells, label) => {
    const text = cells.join('');
    rows.push(label ? `${text}${' '.repeat(labelX - text.length)}${cut(label, labelW, g)}` : text);
  };
  const blankCells = () => {
    const cells = Array.from({ length: cellsWidth }, () => ' ');
    for (const lane of active) cells[lane.x] = g.v;
    return cells;
  };
  // Horizontal connector between two lanes on one row; endpoints are set by the caller.
  const connect = (cells, a, b) => {
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    for (let x = left.x + 1; x < right.x; x += 1) cells[x] = x % 2 === 0 && cells[x] === g.v ? g.x : g.h;
  };

  rows.push(`${' '.repeat(lanes[0].x)}${MAIN}`);
  commits.forEach((commit, i) => {
    const { lane } = commit;
    if (!active.has(lane)) {
      const parent = lane.parent;
      if (!active.has(parent)) active.add(parent);
      const cells = blankCells();
      connect(cells, parent, lane);
      cells[parent.x] = parent.x < lane.x ? g.lj : g.rj;
      cells[lane.x] = parent.x < lane.x ? g.tr : g.tl;
      emit(cells, `branch ${lane.name}`);
      active.add(lane);
    }
    const cells = blankCells();
    if (commit.from) {
      const { from } = commit;
      if (!active.has(from)) fail(`branch ${from.name} has no commits to merge`);
      connect(cells, from, lane);
      const fromEnds = lastUse.get(from) === i && from !== lanes[0];
      cells[from.x] = from.x < lane.x ? (fromEnds ? g.bl : g.lj) : fromEnds ? g.br : g.rj;
    }
    cells[lane.x] = commit.glyph;
    emit(cells, commit.label);
    for (const open of [...active]) {
      if (open !== lanes[0] && lastUse.get(open) === i) active.delete(open);
    }
  });
  if (widest(rows) > maxWidth) fail(`needs more than ${maxWidth} columns`);
  return rows;
};
