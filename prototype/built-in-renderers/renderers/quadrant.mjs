// PROTOTYPE - throwaway. quadrantChart: a boxed 2x2 grid, points placed at the nearest cell with their label
// beside them; a label that finds no room falls back to a number and a legend under the chart. Wayfinder ticket #14.
// Subset: title, `x-axis left [--> right]`, `y-axis bottom [--> top]`, `quadrant-1..4 text`, `name[:::class]: [x, y]`
// with optional styling after the point; classDef lines ignored.
import { fail, cut, padEnd, padStart, len } from '../text.mjs';

const unquote = (s) => s.trim().replace(/^"(.*)"$/, '$1');

export const renderQuadrant = ({ header, lines, maxWidth, g }) => {
  if (!/^quadrantChart$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  let title = '';
  const axis = { xLeft: '', xRight: '', yBottom: '', yTop: '' };
  const quadrants = ['', '', '', ''];
  const points = [];
  let m;
  for (const raw of lines) {
    const line = raw.trim();
    if ((m = line.match(/^title\s+(.*)$/i))) title = m[1].trim();
    else if ((m = line.match(/^x-axis\s+(.*?)(?:\s*-->\s*(.*))?$/i))) [axis.xLeft, axis.xRight] = [unquote(m[1]), unquote(m[2] ?? '')];
    else if ((m = line.match(/^y-axis\s+(.*?)(?:\s*-->\s*(.*))?$/i))) [axis.yBottom, axis.yTop] = [unquote(m[1]), unquote(m[2] ?? '')];
    else if ((m = line.match(/^quadrant-([1-4])\s+(.*)$/i))) quadrants[Number(m[1]) - 1] = unquote(m[2]);
    else if (/^classDef\b/i.test(line)) continue;
    else if ((m = line.match(/^(.*?)(?::::[\w-]+)?\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/))) {
      const [x, y] = [Number(m[2]), Number(m[3])];
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) fail(`point outside 0..1: ${cut(line, 40, g)}`);
      points.push({ label: unquote(m[1]), x, y });
    } else fail(`unsupported line: ${cut(line, 40, g)}`);
  }

  // Plot geometry: odd inner sizes so the divider sits on a cell of its own.
  const qw = Math.min(31, Math.floor((maxWidth - 3) / 2));
  if (qw < 12) fail(`needs more than ${maxWidth} columns`);
  const qh = 6;
  const W = 2 * qw + 1;
  const H = 2 * qh + 1;
  const grid = Array.from({ length: H }, () => Array(W).fill(' '));
  for (let r = 0; r < H; r += 1) grid[r][qw] = g.v;
  for (let c = 0; c < W; c += 1) grid[qh][c] = c === qw ? g.x : g.h;
  const free = (r, c, n) => c >= 0 && c + n <= W && grid[r].slice(c, c + n).every((ch) => ch === ' ');
  const write = (r, c, text) => [...text].forEach((ch, i) => (grid[r][c + i] = ch));

  // Quadrant names in the corners: 2 top-left, 1 top-right, 3 bottom-left, 4 bottom-right.
  const corner = (index, r, right) => {
    const text = cut(quadrants[index], qw - 2, g);
    if (text) write(r, right ? W - 1 - len(text) : 1, text);
  };
  corner(1, 0, false);
  corner(0, 0, true);
  corner(2, H - 1, false);
  corner(3, H - 1, true);

  // Points: marker at the nearest cell, label to the right, else to the left, else a number plus a legend entry.
  const legend = [];
  const placed = points.map((p) => ({ ...p, r: Math.round((1 - p.y) * (H - 1)), c: Math.round(p.x * (W - 1)) }));
  placed.sort((a, b) => a.r - b.r || a.c - b.c);
  for (const p of placed) {
    const label = cut(p.label, qw - 2, g);
    const markerFree = grid[p.r][p.c] === ' ' || grid[p.r][p.c] === g.v || grid[p.r][p.c] === g.h || grid[p.r][p.c] === g.x;
    const n = len(label);
    const centered = Math.min(W - n, Math.max(0, p.c - Math.floor(n / 2)));
    const sameHalf = (c) => (c < qw) === (p.c < qw) && (c + n - 1 < qw) === (p.c < qw);
    const spots = [
      [p.r, p.c + 2, free(p.r, p.c + 1, n + 1)],
      [p.r, p.c - n - 1, free(p.r, p.c - n - 1, n + 1)],
      [p.r + 1, centered, p.r + 1 < H && p.r + 1 !== qh && sameHalf(centered) && free(p.r + 1, centered, n)],
      [p.r - 1, centered, p.r - 1 >= 0 && p.r - 1 !== qh && sameHalf(centered) && free(p.r - 1, centered, n)],
    ];
    const spot = markerFree && spots.find(([, , ok]) => ok);
    if (spot) {
      grid[p.r][p.c] = g.dot;
      write(spot[0], spot[1], label);
    } else {
      // Nearest cell (by ring distance) that is free or on the divider takes a numbered marker.
      const cellFree = (r, c) => r >= 0 && r < H && c >= 0 && c < W && [' ', g.v, g.h, g.x].includes(grid[r][c]);
      let spot = null;
      for (let d = 0; d < W && !spot; d += 1) {
        for (let dr = -d; dr <= d && !spot; dr += 1) {
          for (const dc of [-(d - Math.abs(dr)), d - Math.abs(dr)]) {
            if (cellFree(p.r + dr, p.c + dc)) {
              spot = [p.r + dr, p.c + dc];
              break;
            }
          }
        }
      }
      if (!spot) fail(`no room for point ${cut(p.label, 20, g)}`);
      const n = legend.length + 1;
      const marker = n < 10 ? String(n) : String.fromCharCode(96 + n - 9);
      grid[spot[0]][spot[1]] = marker;
      legend.push(`${marker} ${p.label}`);
    }
  }

  const rows = [];
  if (title) rows.push(cut(title, maxWidth, g), '');
  if (axis.yTop) rows.push(cut(axis.yTop, W + 2, g));
  rows.push(g.tl + g.h.repeat(qw) + g.tj + g.h.repeat(qw) + g.tr);
  grid.forEach((cells, r) => rows.push((r === qh ? g.lj : g.v) + cells.join('') + (r === qh ? g.rj : g.v)));
  rows.push(g.bl + g.h.repeat(qw) + g.bj + g.h.repeat(qw) + g.br);
  if (axis.yBottom) rows.push(cut(axis.yBottom, W + 2, g));
  if (axis.xLeft || axis.xRight) {
    const left = cut(axis.xLeft, qw, g);
    const right = cut(axis.xRight, qw, g);
    rows.push(padEnd(left, W + 2 - len(right)) + right);
  }
  if (legend.length) rows.push('', ...legend.map((l) => cut(l, maxWidth, g)));
  return rows;
};
