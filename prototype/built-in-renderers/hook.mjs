// PROTOTYPE - throwaway. Wayfinder tickets #13, #14 and #15: built-in renderers behind the shared dispatcher,
// size policy (ADR-0005) exercised in the TUI, render deadline (found in #15).
// Stop hook: finds ```mermaid blocks in last_assistant_message, renders each in a worker thread with a
// deadline per diagram, and emits everything through `systemMessage` (ADR-0001) under the per-reply
// output budget (ADR-0005). The renderer bundle is evaluated in the worker only (dynamic import).
// Not production code. Lives on branches prototype/built-in-renderers and prototype/size-policy only.
// Build: `npm ci && npm run build` -> bundle.mjs. Local run: `npm run samples`. TUI run: see TUI-SESSION.md.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const OUTPUT_BUDGET = 9_800;
const DEFAULT_WIDTH = 120;
// Room kept for one closing "diagrams i/N to N/N skipped" line while blocks remain (ADR-0005: the
// whole payload, notices included, fits the budget; the cap is 10,000 per hook output string).
const SUMMARY_RESERVE = 140;
const SEPARATOR = '\n\n';
// The baseline renderer takes about 20 s on a flowchart chain 26 nodes deep and then throws; the hook
// itself is killed by Claude Code at 10 s. A diagram over the deadline becomes a notice, the next one
// is still tried in a fresh worker, and the reply deadline bounds the whole run.
const RENDER_DEADLINE_MS = 3_000;
const REPLY_DEADLINE_MS = 7_000;

if (!isMainThread) {
  // Worker: announce each block (so the main thread knows its type if it has to give up on it), render, post.
  const { renderBlock, typeOf } = await import('./dispatcher.mjs');
  const { blocks, options } = workerData;
  for (const [index, source] of blocks.entries()) {
    parentPort.postMessage({ index, phase: 'start', type: typeOf(source) });
    parentPort.postMessage({ index, phase: 'done', result: renderBlock(source, options) });
  }
} else {
  const startedAt = Date.now();
  const here = dirname(fileURLToPath(import.meta.url));

  const done = (payload) => {
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  };

  if (process.env.MERMAID_FOR_CLAUDE_DISABLE) done({});

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 20) {
    done({ systemMessage: `mermaid-for-claude: Node ${process.versions.node} found, 20 or newer is required; diagram blocks were not rendered` });
  }

  const readJson = (path, fallback) => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return fallback;
    }
  };

  // Fences may sit inside a list item; the body is dedented by the opening fence's indentation.
  const extractBlocks = (reply) => {
    const fence = /^([ \t]*)```mermaid[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
    return [...reply.replace(/\r\n?/g, '\n').matchAll(fence)].map(([, indent, body]) => {
      const dedent = new RegExp(`^[ \\t]{0,${indent.length}}`);
      return body.split('\n').map((line) => line.replace(dedent, '')).join('\n');
    });
  };

  const input = readJson(0, {});
  const blocks = extractBlocks(input.last_assistant_message ?? '');
  if (blocks.length === 0) done({});

  const configuredWidth = Number.parseInt(process.env.MERMAID_FOR_CLAUDE_MAX_WIDTH ?? '', 10);
  const maxWidth = Number.isInteger(configuredWidth) && configuredWidth > 0 ? configuredWidth : DEFAULT_WIDTH;
  const ascii = process.env.MERMAID_FOR_CLAUDE_ASCII === '1';
  const options = { maxWidth, ascii };
  const budgetReason = `output budget exhausted (${OUTPUT_BUDGET.toLocaleString('en-US')} chars per reply)`;
  const deadlineReason = `rendering took longer than ${RENDER_DEADLINE_MS / 1000} s`;
  const replyReason = `reply render deadline (${REPLY_DEADLINE_MS / 1000} s) exhausted`;
  // First word of the first meaningful line: the type shown by a notice for a block never handed to a worker.
  const headerToken = (source) => source.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%'))?.split(/\s+/)[0] ?? 'unknown';

  // Runs one worker over blocks[offset..]; fills results; resolves with the index to resume from
  // (blocks.length when everything rendered). A block over the deadline gets a notice and kills the worker.
  const runWorker = (offset, results, timings) =>
    new Promise((resolve) => {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { blocks: blocks.slice(offset), options } });
      let current = { index: offset, type: headerToken(blocks[offset]), startedAt: Date.now() };
      let settled = false;
      let timer;
      const settle = (next) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(next);
      };
      const giveUp = (reason) => {
        results[current.index] = { type: current.type, reason };
        timings[current.index] = Date.now() - current.startedAt;
        worker.terminate();
        settle(current.index + 1);
      };
      // A block gets the render deadline or whatever the reply deadline leaves, whichever is shorter.
      const arm = () => {
        clearTimeout(timer);
        const remaining = REPLY_DEADLINE_MS - (Date.now() - startedAt);
        const replyBound = remaining < RENDER_DEADLINE_MS;
        timer = setTimeout(() => giveUp(replyBound ? replyReason : deadlineReason), Math.max(0, replyBound ? remaining : RENDER_DEADLINE_MS));
      };
      arm();
      worker.on('message', (message) => {
        const index = offset + message.index;
        if (message.phase === 'start') {
          current = { index, type: message.type, startedAt: Date.now() };
          arm();
          return;
        }
        results[index] = message.result;
        timings[index] = Date.now() - current.startedAt;
        if (index === blocks.length - 1) settle(blocks.length);
      });
      worker.on('error', (err) => giveUp(String(err?.message ?? err).split('\n')[0].slice(0, 100)));
      worker.on('exit', () => {
        if (!settled) giveUp('renderer stopped');
      });
    });

  const results = new Array(blocks.length);
  const timings = new Array(blocks.length).fill(0);
  let next = 0;
  while (next < blocks.length) {
    if (Date.now() - startedAt > REPLY_DEADLINE_MS) {
      for (; next < blocks.length; next += 1) results[next] = { type: headerToken(blocks[next]), reason: replyReason };
      break;
    }
    next = await runWorker(next, results, timings);
  }

  const rendered = results.map((result, index) => {
    const position = `${index + 1}/${blocks.length}`;
    const noticeFor = (reason) => `mermaid-for-claude: could not render diagram ${position} (${result.type}): ${reason}`;
    return {
      result,
      text: result.body ? `mermaid-for-claude: diagram ${position} (${result.type})\n${result.body}` : noticeFor(result.reason),
      budgetNotice: noticeFor(budgetReason),
      ms: timings[index],
    };
  });

  const parts = [];
  const log = [];
  let used = 0;
  for (const [index, entry] of rendered.entries()) {
    const separator = index ? SEPARATOR.length : 0;
    const reserve = index < rendered.length - 1 ? SUMMARY_RESERVE : 0;
    const fits = (text) => used + separator + text.length + reserve <= OUTPUT_BUDGET;
    let text;
    if (fits(entry.text)) text = entry.text;
    else if (fits(entry.budgetNotice)) text = entry.budgetNotice;
    else {
      // Not even one notice per remaining block fits: one line covers the tail.
      text = `mermaid-for-claude: diagrams ${index + 1}/${blocks.length} to ${blocks.length}/${blocks.length} skipped: ${budgetReason}`;
      parts.push(text);
      used += separator + text.length;
      log.push(`d${index + 1}..${blocks.length}=summary`);
      break;
    }
    parts.push(text);
    used += separator + text.length;
    const lines = text.split('\n');
    const reason = text === entry.text ? entry.result.reason : budgetReason;
    log.push(`d${index + 1}=${entry.result.type} ms=${entry.ms} lines=${lines.length} width=${Math.max(...lines.map((l) => [...l].length))}${reason ? ` notice="${reason}"` : ''}`);
  }

  const systemMessage = parts.join(SEPARATOR);
  process.stdout.write(JSON.stringify({ systemMessage }));
  appendFileSync(
    join(here, 'e2e.log'),
    `${new Date().toISOString()} blocks=${blocks.length} chars=${systemMessage.length} totalMs=${Date.now() - startedAt} maxWidth=${maxWidth} ascii=${ascii} ${log.join(' ')}\n`,
  );
  process.exit(0);
}
