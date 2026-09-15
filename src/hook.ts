// Stop hook entry point (ADR-0001): reads the hook JSON from stdin, renders every diagram block of the
// reply and writes the systemMessage payload to stdout. Every failure it can see becomes a notice.
import { readFileSync } from 'node:fs';
import { renderMermaidASCII } from 'beautiful-mermaid';
import { extractDiagramBlocks } from './diagram-blocks.js';

const PLUGIN = 'mermaid-for-claude';
const SEPARATOR = '\n\n';
const BASELINE_OPTIONS = { colorMode: 'none', paddingY: 3, paddingX: 3, boxBorderPadding: 0 } as const;

const done = (payload: object): never => {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
};

const rtrim = (line: string) => line.replace(/\s+$/, '');

const parseStdin = (): { last_assistant_message?: unknown } => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(0, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as { last_assistant_message?: unknown }) : {};
  } catch {
    return {};
  }
};

const renderBlock = (source: string): { type: string; body: string } => {
  const headerLine = source.split('\n').find((line) => line.trim()) ?? '';
  const type = headerLine.trim().split(/\s+/)[0] ?? 'unknown';
  const rows = renderMermaidASCII(source, BASELINE_OPTIONS).split('\n').map(rtrim);
  while (rows.length && !rows[rows.length - 1]) rows.pop();
  while (rows.length && !rows[0]) rows.shift();
  return { type, body: rows.join('\n') };
};

const input = parseStdin();
const reply = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '';
const blocks = extractDiagramBlocks(reply);
if (blocks.length === 0) done({});

const parts = blocks.map((source, index) => {
  const { type, body } = renderBlock(source);
  return `${PLUGIN}: diagram ${index + 1}/${blocks.length} (${type})\n${body}`;
});
done({ systemMessage: parts.join(SEPARATOR) });
