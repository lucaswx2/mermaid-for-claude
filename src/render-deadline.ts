// Render deadline (ADR-0008): blocks render in order inside a worker thread; the main thread arms 3 s per
// block and 7 s per reply from bundle start, and a block gets the shorter of the two. Over the block
// deadline the worker is terminated and a fresh one resumes from the next block. Past the reply deadline
// the remaining blocks become notices without rendering. A worker error or unexpected exit while a
// block is pending gives that block a notice and rendering resumes from the next block.
import { Worker } from 'node:worker_threads';
import { diagramTypeOf } from './diagram-type.js';
import type { Rendered, RenderOptions } from './render-block.js';
import type { RenderWorkerData, RenderWorkerMessage } from './render-worker.js';
import { firstErrorLine, logTrace } from './trace.js';

// Module evaluation is the first thing the bundle does, so this is the bundle start.
const BUNDLE_STARTED_AT = performance.now();
export const BLOCK_DEADLINE_MS = 3_000;
export const REPLY_DEADLINE_MS = 7_000;
export const BLOCK_DEADLINE_REASON = `rendering took longer than ${BLOCK_DEADLINE_MS / 1000} s`;
export const REPLY_DEADLINE_REASON = `reply render deadline (${REPLY_DEADLINE_MS / 1000} s) exhausted`;
export const WORKER_EXIT_REASON = 'renderer stopped';
// The worker bundle sits next to the hook bundle under dist/ (see build.mjs); a URL keeps a plugin root
// with spaces or a Windows drive letter intact.
const WORKER_URL = new URL('./render-worker.mjs', import.meta.url);

export type TimedRender = { rendered: Rendered; ms: number };

export const elapsedSinceBundleStart = () => Math.round(performance.now() - BUNDLE_STARTED_AT);

const isWorkerMessage = (value: unknown): value is RenderWorkerMessage =>
  typeof value === 'object' && value !== null && 'kind' in value && 'index' in value;

// Runs one worker over blocks[offset..] and resolves with the index to resume from: blocks.length when
// the worker rendered everything, the block after the one it gave up on otherwise.
const runWorker = (blocks: string[], offset: number, options: RenderOptions, results: TimedRender[]) =>
  new Promise<number>((resolve) => {
    const workerData = { blocks, offset, options } satisfies RenderWorkerData;
    const worker = new Worker(WORKER_URL, { workerData });
    let current = { index: offset, type: diagramTypeOf(blocks[offset] ?? ''), startedAt: performance.now() };
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const settle = (next: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(next);
    };
    const giveUp = (reason: string) => {
      if (settled) return;
      results[current.index] = { rendered: { kind: 'notice', type: current.type, reason }, ms: Math.round(performance.now() - current.startedAt) };
      settle(current.index + 1);
    };
    // The block deadline, or what the reply deadline leaves when that is shorter.
    const armDeadline = () => {
      clearTimeout(timer);
      const replyRemainingMs = REPLY_DEADLINE_MS - elapsedSinceBundleStart();
      const replyBound = replyRemainingMs < BLOCK_DEADLINE_MS;
      timer = setTimeout(
        () => giveUp(replyBound ? REPLY_DEADLINE_REASON : BLOCK_DEADLINE_REASON),
        Math.max(0, replyBound ? replyRemainingMs : BLOCK_DEADLINE_MS),
      );
    };

    armDeadline();
    worker.on('message', (message: unknown) => {
      if (settled || !isWorkerMessage(message)) return;
      if (message.kind === 'start') {
        current = { index: message.index, type: message.type, startedAt: performance.now() };
        armDeadline();
        return;
      }
      results[message.index] = { rendered: message.rendered, ms: Math.round(performance.now() - current.startedAt) };
      if (message.index === blocks.length - 1) settle(blocks.length);
    });
    worker.on('error', (err) => {
      logTrace(`render worker failed on block ${current.index + 1}`, err);
      giveUp(firstErrorLine(err));
    });
    worker.on('exit', (code) => {
      if (settled) return;
      logTrace(`render worker exited with code ${code} on block ${current.index + 1}`, WORKER_EXIT_REASON);
      giveUp(WORKER_EXIT_REASON);
    });
  });

export const renderWithDeadline = async (blocks: string[], options: RenderOptions) => {
  const results: TimedRender[] = [];
  let next = 0;
  while (next < blocks.length) {
    if (elapsedSinceBundleStart() >= REPLY_DEADLINE_MS) break;
    next = await runWorker(blocks, next, options, results);
  }
  for (; next < blocks.length; next += 1) {
    results[next] = { rendered: { kind: 'notice', type: diagramTypeOf(blocks[next] ?? ''), reason: REPLY_DEADLINE_REASON }, ms: 0 };
  }
  return results;
};
