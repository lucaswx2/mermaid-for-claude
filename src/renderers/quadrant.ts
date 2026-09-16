// quadrantChart (ADR-0007): a box split in four, the quadrant names in the corners, the y-axis labels above
// and below the box, the x-axis labels on a last row, a dot at the nearest cell with its label to the right,
// else to the left, else centred one row below or above inside the same half; a point with no room becomes
// a number with a legend under the chart. Subset: `title`, `x-axis left [--> right]`, `y-axis bottom [--> top]`,
// `quadrant-1..4 text`, `name[:::class]: [x, y]` with x and y in 0..1; styling after a point and `classDef`
// lines ignored.
import type { BuiltinInput } from '../diagram-types.js';
import type { Glyphs } from '../glyphs.js';
import { glyphsFor } from '../glyphs.js';
import { codePointLength, cut, padEnd, RenderError, unsupportedLine } from '../text.js';

type Point = { label: string; x: number; y: number };
type Chart = { title: string; xLeft: string; xRight: string; yBottom: string; yTop: string; quadrants: string[]; points: Point[] };

const TITLE = /^title\s+(.*)$/i;
const X_AXIS = /^x-axis\s+(.*?)(?:\s*-->\s*(.*))?$/i;
const Y_AXIS = /^y-axis\s+(.*?)(?:\s*-->\s*(.*))?$/i;
const QUADRANT = /^quadrant-([1-4])\s+(.*)$/i;
const POINT = /^(.*?)(?::::[\w-]+)?\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/;
const QUADRANT_WIDTH_MAX = 31;
const QUADRANT_WIDTH_MIN = 12;
const QUADRANT_HEIGHT = 6;
const LEGEND_MARKERS = '123456789abcdefghijklmnopqrstuvwxyz';

const unquote = (text: string) => text.trim().replace(/^"(.*)"$/, '$1');

const parseChart = (lines: string[], ellipsis: string) => {
  const chart: Chart = { title: '', xLeft: '', xRight: '', yBottom: '', yTop: '', quadrants: ['', '', '', ''], points: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^classDef\b/i.test(line)) continue;
    const title = line.match(TITLE);
    if (title) {
      chart.title = (title[1] ?? '').trim();
      continue;
    }
    const xAxis = line.match(X_AXIS);
    if (xAxis) {
      [chart.xLeft, chart.xRight] = [unquote(xAxis[1] ?? ''), unquote(xAxis[2] ?? '')];
      continue;
    }
    const yAxis = line.match(Y_AXIS);
    if (yAxis) {
      [chart.yBottom, chart.yTop] = [unquote(yAxis[1] ?? ''), unquote(yAxis[2] ?? '')];
      continue;
    }
    const quadrant = line.match(QUADRANT);
    if (quadrant) {
      chart.quadrants[Number(quadrant[1]) - 1] = unquote(quadrant[2] ?? '');
      continue;
    }
    const point = line.match(POINT);
    const [x, y] = [Number(point?.[2]), Number(point?.[3])];
    if (!point || !(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw unsupportedLine(line, ellipsis);
    chart.points.push({ label: unquote(point[1] ?? ''), x, y });
  }
  return chart;
};

// The plot: a character grid with the divider drawn and an occupancy map so no label, dot or number ever
// lands on another; a label keeps off the divider, a dot or a number may replace a divider glyph.
class Plot {
  readonly cells: string[][];
  readonly written: boolean[][];
  constructor(
    readonly width: number,
    readonly height: number,
    readonly halfWidth: number,
    readonly halfHeight: number,
    glyphs: Glyphs,
  ) {
    this.cells = Array.from({ length: height }, () => Array<string>(width).fill(' '));
    this.written = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
    for (let row = 0; row < height; row += 1) this.cells[row]![halfWidth] = glyphs.vertical;
    for (let col = 0; col < width; col += 1) this.cells[halfHeight]![col] = col === halfWidth ? glyphs.cross : glyphs.horizontal;
  }

  inside(row: number, col: number) {
    return row >= 0 && row < this.height && col >= 0 && col < this.width;
  }

  // A cell a dot or a number may take: inside the plot and not written yet.
  open(row: number, col: number) {
    return this.inside(row, col) && !this.written[row]![col];
  }

  // A run of cells a label may take: open and off the divider.
  free(row: number, col: number, length: number) {
    if (!this.inside(row, col) || col + length > this.width || row === this.halfHeight) return false;
    for (let index = col; index < col + length; index += 1) if (this.written[row]![index] || index === this.halfWidth) return false;
    return true;
  }

  write(row: number, col: number, text: string) {
    [...text].forEach((char, index) => {
      this.cells[row]![col + index] = char;
      this.written[row]![col + index] = true;
    });
  }

  // Corner text: quadrant 2 top-left, 1 top-right, 3 bottom-left, 4 bottom-right.
  corner(text: string, row: number, right: boolean) {
    if (text) this.write(row, right ? this.width - 1 - codePointLength(text) : 1, text);
  }

  // The label spots in order of preference: right of the dot, left of it, centred one row below, then above,
  // the last two only inside the same half so a label never straddles the divider or lands on it.
  labelSpot(row: number, col: number, length: number) {
    const centred = Math.min(this.width - length, Math.max(0, col - Math.floor(length / 2)));
    const sameHalf = (col < this.halfWidth) === (centred < this.halfWidth) && (col < this.halfWidth) === (centred + length - 1 < this.halfWidth);
    const spots: [number, number, boolean][] = [
      [row, col + 2, this.free(row, col + 1, length + 1)],
      [row, col - length - 1, this.free(row, col - length - 1, length + 1)],
      [row + 1, centred, sameHalf && this.free(row + 1, centred, length)],
      [row - 1, centred, sameHalf && this.free(row - 1, centred, length)],
    ];
    return spots.find(([, , fits]) => fits);
  }

  // The nearest free cell by ring distance, for a numbered marker.
  nearestFree(row: number, col: number) {
    for (let distance = 0; distance < this.width + this.height; distance += 1) {
      for (let rowStep = -distance; rowStep <= distance; rowStep += 1) {
        const colStep = distance - Math.abs(rowStep);
        for (const candidate of [col - colStep, col + colStep]) {
          if (this.open(row + rowStep, candidate)) return [row + rowStep, candidate] as const;
        }
      }
    }
    return undefined;
  }
}

const placePoints = (plot: Plot, points: Point[], glyphs: Glyphs) => {
  const legend: string[] = [];
  const placed = points.map((point) => ({ ...point, row: Math.round((1 - point.y) * (plot.height - 1)), col: Math.round(point.x * (plot.width - 1)) }));
  placed.sort((a, b) => a.row - b.row || a.col - b.col);
  for (const point of placed) {
    const label = cut(point.label, plot.halfWidth - 2, glyphs.ellipsis);
    const spot = plot.open(point.row, point.col) ? plot.labelSpot(point.row, point.col, codePointLength(label)) : undefined;
    if (spot) {
      plot.write(point.row, point.col, glyphs.dot);
      plot.write(spot[0], spot[1], label);
      continue;
    }
    const cell = plot.nearestFree(point.row, point.col);
    const marker = LEGEND_MARKERS[legend.length];
    if (!cell || !marker) throw new RenderError(`no room for point ${cut(point.label, 20, glyphs.ellipsis)}`);
    plot.write(cell[0], cell[1], marker);
    legend.push(`${marker} ${point.label}`);
  }
  return legend;
};

export const renderQuadrant = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^quadrantChart$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const chart = parseChart(lines, glyphs.ellipsis);

  // Odd inner sizes so the divider sits on a cell of its own.
  const halfWidth = Math.min(QUADRANT_WIDTH_MAX, Math.floor((widthLimit - 3) / 2));
  if (halfWidth < QUADRANT_WIDTH_MIN) throw new RenderError(`needs more than ${widthLimit} columns`);
  const plot = new Plot(2 * halfWidth + 1, 2 * QUADRANT_HEIGHT + 1, halfWidth, QUADRANT_HEIGHT, glyphs);
  const cornerText = (index: number) => cut(chart.quadrants[index] ?? '', halfWidth - 2, glyphs.ellipsis);
  plot.corner(cornerText(1), 0, false);
  plot.corner(cornerText(0), 0, true);
  plot.corner(cornerText(2), plot.height - 1, false);
  plot.corner(cornerText(3), plot.height - 1, true);
  const legend = placePoints(plot, chart.points, glyphs);

  const outerWidth = plot.width + 2;
  const rows: string[] = [];
  if (chart.title) rows.push(cut(chart.title, widthLimit, glyphs.ellipsis), '');
  if (chart.yTop) rows.push(cut(chart.yTop, outerWidth, glyphs.ellipsis));
  const edge = (left: string, middle: string, right: string) => left + glyphs.horizontal.repeat(halfWidth) + middle + glyphs.horizontal.repeat(halfWidth) + right;
  rows.push(edge(glyphs.topLeft, glyphs.teeDown, glyphs.topRight));
  plot.cells.forEach((cells, row) => {
    const divider = row === plot.halfHeight;
    rows.push((divider ? glyphs.teeRight : glyphs.vertical) + cells.join('') + (divider ? glyphs.teeLeft : glyphs.vertical));
  });
  rows.push(edge(glyphs.bottomLeft, glyphs.teeUp, glyphs.bottomRight));
  if (chart.yBottom) rows.push(cut(chart.yBottom, outerWidth, glyphs.ellipsis));
  if (chart.xLeft || chart.xRight) {
    const right = cut(chart.xRight, halfWidth, glyphs.ellipsis);
    rows.push(padEnd(cut(chart.xLeft, halfWidth, glyphs.ellipsis), outerWidth - codePointLength(right)) + right);
  }
  if (legend.length) rows.push('', ...legend.map((entry) => cut(entry, widthLimit, glyphs.ellipsis)));
  return rows;
};
