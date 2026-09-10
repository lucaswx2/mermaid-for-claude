// PROTOTYPE - throwaway. Wayfinder ticket #5: channel spike.
// Stop hook that pushes a fixed box-drawing diagram through the channel named in ./VARIANT.
// Not production code. Lives on branch prototype/channel-spike only; delete when #5 is closed.
//
// Variants (write one of these names into ./VARIANT, no restart needed):
//   systemMessage          12-line diagram (~900 chars) via top-level `systemMessage`
//   systemMessage-2500     numbered lines, > 2500 chars, end marker on the last line
//   systemMessage-10500    numbered lines, > 10500 chars (doc says 10,000 cap -> file + preview)
//   terminalSequence       "\n" + diagram + "\n" via top-level `terminalSequence`
//   terminalSequence-crlf  same with "\r\n" line endings
//   terminalSequence-osc9  positive control: OSC 9 desktop notification, allowlisted
//   both                   systemMessage + terminalSequence in one output
//   off                    `{}`

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const startedAt = Date.now();
const here = dirname(fileURLToPath(import.meta.url));

const DIAGRAM = [
  '┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐',
  '│    Stop hook     │─────▶│     renderer     │─────▶│     terminal     │',
  '└────────┬─────────┘      └────────┬─────────┘      └──────────────────┘',
  '         │                         │',
  '         │ diagram block           │ unsupported type',
  '         ▼                         ▼',
  '┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐',
  '│ beautiful-mermaid│      │      notice      │─────▶│    scrollback    │',
  '└────────┬─────────┘      └──────────────────┘      └──────────────────┘',
  '         │ ASCII/Unicode text                                  ▲',
  '         │                                                     │',
  '         └─────────────────────────────────────────────────────┘',
].join('\n');

const label = (name) => `[spike ${name}]`;

const numberedUntil = (minChars) => {
  const lines = [];
  let text = '';
  let n = 0;
  while (text.length <= minChars) {
    for (const line of DIAGRAM.split('\n')) {
      n += 1;
      lines.push(`L${String(n).padStart(3, '0')} ${line}`);
    }
    text = lines.join('\n');
  }
  lines.push(`<< END OF ${minChars} VARIANT. Last line is L${String(n).padStart(3, '0')}. If you can read this, nothing was cut. >>`);
  return lines.join('\n');
};

const OSC9 = `\u001b]9;${label('terminalSequence-osc9')} reached the terminal\u0007`;

const outputs = {
  'systemMessage': () => ({ systemMessage: `${label('systemMessage ~900 chars, 12 lines')}\n${DIAGRAM}` }),
  'systemMessage-2500': () => ({ systemMessage: `${label('systemMessage-2500')}\n${numberedUntil(2500)}` }),
  'systemMessage-10500': () => ({ systemMessage: `${label('systemMessage-10500')}\n${numberedUntil(10500)}` }),
  'terminalSequence': () => ({ terminalSequence: `\n${label('terminalSequence')}\n${DIAGRAM}\n` }),
  'terminalSequence-crlf': () => ({ terminalSequence: `\r\n${label('terminalSequence-crlf')}\r\n${DIAGRAM.replaceAll('\n', '\r\n')}\r\n` }),
  'terminalSequence-osc9': () => ({ terminalSequence: OSC9 }),
  'both': () => ({
    systemMessage: `${label('both / systemMessage')}\n${DIAGRAM}`,
    terminalSequence: `\n${label('both / terminalSequence')}\n${DIAGRAM}\n`,
  }),
  'off': () => ({}),
};

const readVariant = () => {
  try { return readFileSync(join(here, 'VARIANT'), 'utf8').trim() || 'systemMessage'; }
  catch { return 'systemMessage'; }
};

const readStdin = () => {
  try { return JSON.parse(readFileSync(0, 'utf8')); }
  catch { return {}; }
};

const variant = readVariant();
const input = readStdin();
const build = outputs[variant] ?? (() => ({ systemMessage: `${label('unknown variant "' + variant + '"')} known: ${Object.keys(outputs).join(', ')}` }));
const out = build();

process.stdout.write(JSON.stringify(out));

const sizes = Object.entries(out).map(([k, v]) => `${k}=${v.length}`).join(' ');
appendFileSync(join(here, 'spike.log'), [
  new Date().toISOString(),
  `variant=${variant}`,
  sizes || 'empty',
  `hookMs=${Date.now() - startedAt}`,
  `stop_hook_active=${input.stop_hook_active ?? 'n/a'}`,
  `lastMsgChars=${(input.last_assistant_message ?? '').length}`,
  `claude=${process.env.CLAUDE_CODE_VERSION ?? 'n/a'}`,
].join(' ') + '\n');
