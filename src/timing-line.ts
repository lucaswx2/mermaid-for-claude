// One `key=value` line on stderr per reply with a diagram (spec #16): the reply summary, then one
// `dN=type ms=… rows=… width=…` group per block with its notice reason when it has one. `terminal=` is
// the measured width and where it came from (ADR-0008): `live` for the Windows console helper, `tty` for
// /dev/tty, `cache` for the width the SessionStart hook measured, `none/none` when nothing answered.
import type { RenderOptions } from './render-block.js';
import type { TimedRender } from './render-deadline.js';
import type { TerminalWidth } from './terminal-width.js';
import { PLUGIN_NAME } from './trace.js';

type TimingSummary = { payloadLength: number; totalMs: number; options: RenderOptions; terminal: TerminalWidth };

const blockGroup = ({ rendered, ms }: TimedRender, index: number) => {
  const rows = rendered.kind === 'diagram' ? rendered.body.split('\n') : [];
  const width = rows.reduce((widest, row) => Math.max(widest, [...row].length), 0);
  const notice = rendered.kind === 'notice' ? ` notice=${JSON.stringify(rendered.reason)}` : '';
  return `d${index + 1}=${rendered.type} ms=${ms} rows=${rows.length} width=${width}${notice}`;
};

export const timingLineFor = (results: TimedRender[], { payloadLength, totalMs, options, terminal }: TimingSummary) =>
  [
    `${PLUGIN_NAME}: blocks=${results.length}`,
    `chars=${payloadLength}`,
    `totalMs=${totalMs}`,
    `terminal=${terminal.source === 'none' ? 'none' : terminal.columns}/${terminal.source}`,
    `widthLimit=${options.widthLimit}`,
    `ascii=${options.useAscii}`,
    ...results.map(blockGroup),
  ].join(' ');
