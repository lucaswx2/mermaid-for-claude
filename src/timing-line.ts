// One `key=value` line on stderr per reply with a diagram (spec #16): the reply summary, then one
// `dN=type ms=… rows=… width=…` group per block with its notice reason when it has one. The terminal
// width and its source (`live`, `cache`, `tty`) arrive with the live width limit; until then `none/none`.
import type { RenderOptions } from './render-block.js';
import type { TimedRender } from './render-deadline.js';
import { PLUGIN_NAME } from './trace.js';

type TimingSummary = { payloadLength: number; totalMs: number; options: RenderOptions };

const blockGroup = ({ rendered, ms }: TimedRender, index: number) => {
  const rows = rendered.kind === 'diagram' ? rendered.body.split('\n') : [];
  const width = rows.reduce((widest, row) => Math.max(widest, [...row].length), 0);
  const notice = rendered.kind === 'notice' ? ` notice=${JSON.stringify(rendered.reason)}` : '';
  return `d${index + 1}=${rendered.type} ms=${ms} rows=${rows.length} width=${width}${notice}`;
};

export const timingLineFor = (results: TimedRender[], { payloadLength, totalMs, options }: TimingSummary) =>
  [
    `${PLUGIN_NAME}: blocks=${results.length}`,
    `chars=${payloadLength}`,
    `totalMs=${totalMs}`,
    'terminal=none/none',
    `widthLimit=${options.widthLimit}`,
    `ascii=${options.useAscii}`,
    ...results.map(blockGroup),
  ].join(' ');
