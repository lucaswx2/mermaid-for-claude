// PROTOTYPE - throwaway. Feeds samples/*.mmd through the hook as if each were a Stop hook input.
// Usage: node render-samples.mjs [names...] [--ascii] [--width N] [--reply] [--bundle]
//   --reply   put every selected sample into ONE reply (exercises the output budget)
//   --bundle  run bundle.mjs instead of hook.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const width = args.includes('--width') ? args[args.indexOf('--width') + 1] : undefined;
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--width');
const entry = flag('--bundle') ? 'bundle.mjs' : 'hook.mjs';
const env = { ...process.env };
if (flag('--ascii')) env.MERMAID_FOR_CLAUDE_ASCII = '1';
if (width) env.MERMAID_FOR_CLAUDE_MAX_WIDTH = width;

const files = readdirSync('samples')
  .filter((n) => n.endsWith('.mmd'))
  .filter((n) => names.length === 0 || names.some((x) => n === x || n === `${x}.mmd`));

const run = (label, reply) => {
  const input = JSON.stringify({ last_assistant_message: reply });
  const t0 = Date.now();
  const res = spawnSync('node', [entry], { input, encoding: 'utf8', env });
  const ms = Date.now() - t0;
  const out = JSON.parse(res.stdout || '{}');
  const message = out.systemMessage ?? '';
  const lines = message.split('\n');
  const widest = Math.max(...lines.map((l) => [...l].length));
  console.log(`===== ${label}  exit=${res.status} processMs=${ms} chars=${message.length} lines=${lines.length} width=${widest} =====`);
  console.log(message || res.stderr);
  console.log();
};

const asReply = (name) => 'Here it is:\n\n```mermaid\n' + readFileSync(`samples/${name}`, 'utf8').replace(/\s*$/, '\n') + '```\n';

if (flag('--reply')) run(files.join(' + '), files.map(asReply).join('\nAnd another one:\n\n'));
else for (const name of files) run(name, asReply(name));
