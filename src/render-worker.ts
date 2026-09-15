// Worker thread entry (ADR-0008): the only place the renderer bundle is evaluated. Built as its own
// bundle (dist/render-worker.mjs) so the main thread never parses the renderer. Renders the blocks from
// `offset` on, in order, announcing each block's type before rendering it so the main thread knows which
// block to blame when it gives up.
import { parentPort, workerData } from 'node:worker_threads';
import { diagramTypeOf } from './diagram-type.js';
import { renderBlock, type Rendered, type RenderOptions } from './render-block.js';

export type RenderWorkerData = { blocks: string[]; offset: number; options: RenderOptions };
export type RenderWorkerMessage = { kind: 'start'; index: number; type: string } | { kind: 'result'; index: number; rendered: Rendered };

const isWorkerData = (value: unknown): value is RenderWorkerData =>
  typeof value === 'object' && value !== null && 'blocks' in value && 'offset' in value && 'options' in value;

if (parentPort === null || !isWorkerData(workerData)) throw new Error('render worker started without a parent port or its work');

const { blocks, offset, options } = workerData;
const post = (message: RenderWorkerMessage) => parentPort?.postMessage(message);

for (let index = offset; index < blocks.length; index += 1) {
  const source = blocks[index] ?? '';
  post({ kind: 'start', index, type: diagramTypeOf(source) });
  post({ kind: 'result', index, rendered: renderBlock(source, options) });
}
