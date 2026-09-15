// journey (ADR-0006): one row per task with a five-dot score, the score and the actors on the right,
// sections as headings. Subset: `title`, `section`, `task: score[: actor, actor]`.
import type { BuiltinInput } from '../diagram-types.js';
import { glyphsFor } from '../glyphs.js';
import { cut, padEnd, padStart, RenderError, unsupportedLine, widestRow } from '../text.js';

type Task = { name: string; score: number; actors: string };
type Section = { name: string; tasks: Task[] };

const NUMBER = /^-?\d+(\.\d+)?$/;
const DOTS = 5;
const NAME_WIDTH_MAX = 48;
const NAME_WIDTH_MIN = 12;
const ACTORS_WIDTH_MIN = 6;

const parseTask = (line: string) => {
  const parts = line.split(':').map((part) => part.trim());
  if (parts.length < 2) return undefined;
  let actors = '';
  let score = parts.pop() ?? '';
  if (!NUMBER.test(score)) {
    actors = score;
    score = parts.pop() ?? '';
  }
  if (!NUMBER.test(score) || parts.length === 0) return undefined;
  return { name: parts.join(': '), score: Number(score), actors };
};

const parseSections = (lines: string[], ellipsis: string) => {
  let title = '';
  const sections: Section[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^title\b/i.test(line)) {
      title = line.replace(/^title\b/i, '').trim();
      continue;
    }
    if (/^section\b/i.test(line)) {
      sections.push({ name: line.replace(/^section\b/i, '').trim(), tasks: [] });
      continue;
    }
    const task = parseTask(line);
    if (!task) throw unsupportedLine(line, ellipsis);
    if (sections.length === 0) sections.push({ name: '', tasks: [] });
    sections[sections.length - 1]?.tasks.push(task);
  }
  return { title, sections };
};

export const renderJourney = ({ headerLine, lines, widthLimit, useAscii }: BuiltinInput) => {
  const glyphs = glyphsFor(useAscii);
  if (!/^journey$/i.test(headerLine)) throw unsupportedLine(headerLine, glyphs.ellipsis);
  const { title, sections } = parseSections(lines, glyphs.ellipsis);
  const tasks = sections.flatMap((section) => section.tasks);
  if (tasks.length === 0) throw new RenderError('no tasks');

  const scoreWidth = widestRow(tasks.map((task) => String(task.score)));
  const hasActors = tasks.some((task) => task.actors);
  let nameWidth = Math.min(NAME_WIDTH_MAX, widestRow(tasks.map((task) => task.name)));
  let actorsWidth = hasActors ? widestRow(tasks.map((task) => task.actors)) : 0;
  const rowWidth = () => 2 + nameWidth + 2 + DOTS + 2 + scoreWidth + (hasActors ? 2 + actorsWidth : 0);
  while (rowWidth() > widthLimit && nameWidth > NAME_WIDTH_MIN) nameWidth -= 1;
  while (rowWidth() > widthLimit && actorsWidth > ACTORS_WIDTH_MIN) actorsWidth -= 1;
  if (rowWidth() > widthLimit) throw new RenderError(`needs more than ${widthLimit} columns`);

  const rows: string[] = [];
  if (title) rows.push(cut(title, widthLimit, glyphs.ellipsis), '');
  for (const section of sections) {
    if (section.name) rows.push(cut(section.name, widthLimit, glyphs.ellipsis));
    for (const task of section.tasks) {
      const filled = Math.min(DOTS, Math.max(0, Math.round(task.score)));
      const dots = glyphs.dot.repeat(filled) + glyphs.dotEmpty.repeat(DOTS - filled);
      const actors = hasActors ? `  ${cut(task.actors, actorsWidth, glyphs.ellipsis)}` : '';
      rows.push(`  ${padEnd(cut(task.name, nameWidth, glyphs.ellipsis), nameWidth)}  ${dots}  ${padStart(String(task.score), scoreWidth)}${actors}`);
    }
  }
  return rows;
};
