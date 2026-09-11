// PROTOTYPE - throwaway. Wayfinder ticket #7: end-to-end render of real diagram blocks.
// Stop hook: finds ```mermaid blocks in last_assistant_message, renders each with beautiful-mermaid,
// and emits the result through `systemMessage` (ADR-0001). Not production code.
// Lives on branch prototype/end-to-end only. Build: `npm ci && npm run build` -> bundle.mjs.
// Runtime knobs: ./options.json, merged over { useAscii: false, colorMode: 'none' }; no restart needed.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMermaidASCII } from 'beautiful-mermaid';

const startedAt = Date.now();
const here = dirname(fileURLToPath(import.meta.url));
const CHANNEL_CAP = 10_000;
const BUDGET = 9_500;

const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
};

const input = readJson(0, {});
const options = { useAscii: false, colorMode: 'none', ...readJson(join(here, 'options.json'), {}) };

const fence = /```mermaid[^\n]*\n([\s\S]*?)```/g;
const blocks = [...(input.last_assistant_message ?? '').matchAll(fence)].map((m) => m[1].trim());

if (blocks.length === 0) {
  process.stdout.write('{}');
  process.exit(0);
}

const typeOf = (src) =>
  (src.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%')) ?? '').split(/\s+/)[0] || 'unknown';

const notice = (type, err) => {
  const message = String(err?.message ?? err).split('\n')[0];
  if (message.startsWith('Invalid mermaid header')) return `mermaid-for-claude: unsupported diagram type "${type}"`;
  return `mermaid-for-claude: could not render this ${type} diagram: ${message.slice(0, 80)}`;
};

const render = (src) =>
  renderMermaidASCII(src, options).split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\s+$/, '');

const parts = [];
const log = [];
blocks.forEach((src, i) => {
  const t0 = Date.now();
  const type = typeOf(src);
  let body;
  try { body = render(src); } catch (err) { body = notice(type, err); }
  const lines = body.split('\n');
  const width = Math.max(...lines.map((l) => l.length));
  log.push(`d${i + 1}=${type} ms=${Date.now() - t0} lines=${lines.length} width=${width}`);
  parts.push(`diagram ${i + 1}/${blocks.length} (${type})\n${body}`);
});

let text = '\n' + parts.join('\n\n');
if (text.length > BUDGET) {
  const kept = text.slice(0, BUDGET).split('\n');
  kept.pop();
  const dropped = text.split('\n').length - kept.length;
  text = `${kept.join('\n')}\nmermaid-for-claude: ${dropped} lines omitted (channel cap ${CHANNEL_CAP} chars)`;
}

process.stdout.write(JSON.stringify({ systemMessage: text }));
appendFileSync(
  join(here, 'e2e.log'),
  `${new Date().toISOString()} blocks=${blocks.length} chars=${text.length} totalMs=${Date.now() - startedAt} opts=${JSON.stringify(options)} ${log.join(' ')}\n`,
);
