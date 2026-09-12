// PROTOTYPE - throwaway. journey: one row per task with a five-dot satisfaction score and its actors.
// Subset: title, section, `task name: score[: actor, actor]`.
import { fail, cut, padEnd, padStart, widest } from '../text.mjs';

const NUMBER = /^-?\d+(\.\d+)?$/;

export const renderJourney = ({ header, lines, maxWidth, g }) => {
  if (!/^journey$/i.test(header)) fail(`unsupported header: ${cut(header, 40, g)}`);
  let title = '';
  const sections = [];
  let section = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^title\b/i.test(line)) {
      title = line.replace(/^title\b/i, '').trim();
      continue;
    }
    if (/^section\b/i.test(line)) {
      section = { name: line.replace(/^section\b/i, '').trim(), tasks: [] };
      sections.push(section);
      continue;
    }
    const parts = line.split(':').map((p) => p.trim());
    if (parts.length < 2) fail(`unsupported line: ${cut(line, 40, g)}`);
    let actors = '';
    let score = parts.pop();
    if (!NUMBER.test(score)) {
      actors = score;
      score = parts.pop() ?? '';
    }
    if (!NUMBER.test(score) || !parts.length) fail(`unsupported line: ${cut(line, 40, g)}`);
    if (!section) {
      section = { name: '', tasks: [] };
      sections.push(section);
    }
    section.tasks.push({ name: parts.join(': '), score: Number(score), actors });
  }
  const tasks = sections.flatMap((s) => s.tasks);
  if (!tasks.length) fail('no tasks');

  const scoreText = tasks.map((t) => String(t.score));
  const scoreW = widest(scoreText);
  const hasActors = tasks.some((t) => t.actors);
  let nameW = Math.min(48, widest(tasks.map((t) => t.name)));
  let actorsW = hasActors ? widest(tasks.map((t) => t.actors)) : 0;
  const fixed = () => 2 + nameW + 2 + 5 + 2 + scoreW + (hasActors ? 2 + actorsW : 0);
  while (fixed() > maxWidth && nameW > 12) nameW -= 1;
  while (fixed() > maxWidth && actorsW > 6) actorsW -= 1;
  if (fixed() > maxWidth) fail(`needs more than ${maxWidth} columns`);

  const rows = [];
  if (title) rows.push(cut(title, maxWidth, g), '');
  for (const s of sections) {
    if (s.name) rows.push(cut(s.name, maxWidth, g));
    s.tasks.forEach((t) => {
      const filled = Math.min(5, Math.max(0, Math.round(t.score)));
      const dots = g.dot.repeat(filled) + g.dotEmpty.repeat(5 - filled);
      const actors = hasActors ? `  ${cut(t.actors, actorsW, g)}` : '';
      rows.push(`  ${padEnd(cut(t.name, nameW, g), nameW)}  ${dots}  ${padStart(String(t.score), scoreW)}${actors}`);
    });
  }
  return rows;
};
