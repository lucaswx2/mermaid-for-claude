// PROTOTYPE - throwaway. Wayfinder ticket #13: S-tier built-in renderers behind the shared dispatcher.
// Stop hook: finds ```mermaid blocks in last_assistant_message, renders each through the dispatcher and
// emits everything through `systemMessage` (ADR-0001) under the per-reply output budget (ADR-0005).
// Not production code. Lives on branch prototype/built-in-renderers only.
// Build: `npm ci && npm run build` -> bundle.mjs. Local run: `npm run samples`.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBlock } from './dispatcher.mjs';

const startedAt = Date.now();
const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT_BUDGET = 9_800;
const DEFAULT_WIDTH = 120;

const done = (payload) => {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
};

if (process.env.MERMAID_FOR_CLAUDE_DISABLE) done({});

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

const parts = [];
const log = [];
let used = 0;
blocks.forEach((source, index) => {
  const t0 = Date.now();
  const position = `${index + 1}/${blocks.length}`;
  const result = renderBlock(source, { maxWidth, ascii });
  const noticeFor = (reason) => `mermaid-for-claude: could not render diagram ${position} (${result.type}): ${reason}`;
  let text = result.body ? `mermaid-for-claude: diagram ${position} (${result.type})\n${result.body}` : noticeFor(result.reason);
  const separator = parts.length ? 2 : 0;
  if (used + separator + text.length > OUTPUT_BUDGET) {
    text = noticeFor(`output budget exhausted (${OUTPUT_BUDGET.toLocaleString('en-US')} chars per reply)`);
  }
  parts.push(text);
  used += separator + text.length;
  const lines = text.split('\n');
  log.push(`d${index + 1}=${result.type} ms=${Date.now() - t0} lines=${lines.length} width=${Math.max(...lines.map((l) => [...l].length))}${result.reason ? ` notice="${result.reason}"` : ''}`);
});

const systemMessage = parts.join('\n\n');
process.stdout.write(JSON.stringify({ systemMessage }));
appendFileSync(
  join(here, 'e2e.log'),
  `${new Date().toISOString()} blocks=${blocks.length} chars=${systemMessage.length} totalMs=${Date.now() - startedAt} maxWidth=${maxWidth} ascii=${ascii} ${log.join(' ')}\n`,
);
