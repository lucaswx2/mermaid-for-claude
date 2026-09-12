// PROTOTYPE - throwaway. Feeds samples/*.mmd through the hook as if each were a Stop hook input.
// Usage: node render-samples.mjs [names...] [--ascii] [--width N] [--reply] [--bundle] [--wrapper]
//   --reply   put every selected sample into ONE reply (exercises the output budget)
//   --bundle  run bundle.mjs instead of hook.mjs
//   --wrapper run bash stop.sh (ADR-0003 wrapper in front of bundle.mjs)
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const width = args.includes('--width') ? args[args.indexOf('--width') + 1] : undefined;
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--width');
const entry = flag('--bundle') ? 'bundle.mjs' : 'hook.mjs';
const command = flag('--wrapper') ? ['bash', ['stop.sh']] : ['node', [entry]];
const env = { ...process.env };
if (flag('--ascii')) env.MERMAID_FOR_CLAUDE_ASCII = '1';
if (width) env.MERMAID_FOR_CLAUDE_MAX_WIDTH = width;

// Given names keep their order (a reply's block order matters for the budget and the deadline).
const all = readdirSync('samples').filter((n) => n.endsWith('.mmd'));
const files = names.length === 0 ? all : names.map((x) => all.find((n) => n === x || n === `${x}.mmd`)).filter(Boolean);

const run = (label, reply) => {
  // A fixed session id so the Windows width cache (cache/shell-run.width) is exercised like in the TUI.
  const input = JSON.stringify({ session_id: 'shell-run', last_assistant_message: reply });
  const t0 = Date.now();
  const res = spawnSync(command[0], command[1], { input, encoding: 'utf8', env });
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
