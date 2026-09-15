// Payload assembly under the per-reply output budget (ADR-0005, ADR-0008). Every block becomes a header
// plus body or a one-line notice; blocks are placed in order and one that does not fit becomes a budget
// notice while the next is still tried. Headers, bodies, notices and separators all count.
import type { Rendered } from './render-block.js';
import { PLUGIN_NAME } from './trace.js';

// Under the 10,000-character cap of a hook's systemMessage (ADR-0001).
export const OUTPUT_BUDGET_CHARS = 9_800;
// Room kept for the closing "diagrams i/N to N/N skipped" line while blocks remain, so it always fits.
export const SUMMARY_RESERVE_CHARS = 140;
export const SEPARATOR = '\n\n';
export const BUDGET_EXHAUSTED_REASON = `output budget exhausted (${OUTPUT_BUDGET_CHARS.toLocaleString('en-US')} chars per reply)`;

const noticeLine = (position: string, type: string, reason: string) =>
  `${PLUGIN_NAME}: could not render diagram ${position} (${type}): ${reason}`;

const blockText = (rendered: Rendered, position: string) =>
  rendered.kind === 'diagram'
    ? `${PLUGIN_NAME}: diagram ${position} (${rendered.type})\n${rendered.body}`
    : noticeLine(position, rendered.type, rendered.reason);

export const assemblePayload = (blocks: readonly Rendered[]) => {
  const total = blocks.length;
  const parts: string[] = [];
  let used = 0;
  for (const [index, rendered] of blocks.entries()) {
    const position = `${index + 1}/${total}`;
    const separator = index ? SEPARATOR.length : 0;
    const reserve = index < total - 1 ? SUMMARY_RESERVE_CHARS : 0;
    const fits = (text: string) => used + separator + text.length + reserve <= OUTPUT_BUDGET_CHARS;

    const text = blockText(rendered, position);
    const budgetNotice = noticeLine(position, rendered.type, BUDGET_EXHAUSTED_REASON);
    const placed = fits(text) ? text : fits(budgetNotice) ? budgetNotice : undefined;
    if (placed === undefined) {
      // Not even one notice per remaining block fits: one line covers the tail.
      parts.push(`${PLUGIN_NAME}: diagrams ${position} to ${total}/${total} skipped: ${BUDGET_EXHAUSTED_REASON}`);
      break;
    }
    parts.push(placed);
    used += separator + placed.length;
  }
  return parts.join(SEPARATOR);
};
