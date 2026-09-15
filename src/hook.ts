// Stop hook entry point (ADR-0001): reads the hook JSON from stdin, renders every diagram block of the
// reply and writes the systemMessage payload to stdout. Every failure it can see becomes a notice.
import { readFileSync } from 'node:fs';
import { renderMermaidASCII } from 'beautiful-mermaid';
import { extractDiagramBlocks } from './diagram-blocks.js';

const PLUGIN = 'mermaid-for-claude';
const SEPARATOR = '\n\n';
const NODE_MAJOR_REQUIRED = 20;
const BASELINE_OPTIONS = { colorMode: 'none', paddingY: 3, paddingX: 3, boxBorderPadding: 0 } as const;

type Rendered = { type: string; body: string } | { type: string; reason: string };

const done = (payload: object): never => {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
};

const rtrim = (line: string) => line.replace(/\s+$/, '');

// Env var truthiness (ticket #8): unset, empty, 0 and false are off; anything else is on.
const isFlagSet = (value: string | undefined) => value !== undefined && !['', '0', 'false'].includes(value);

const firstErrorLine = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0]?.slice(0, 100) ?? 'unknown error';
};

const parseStdin = (): { last_assistant_message?: unknown } => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(0, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as { last_assistant_message?: unknown }) : {};
  } catch {
    return {};
  }
};

const renderBlock = (source: string, useAscii: boolean): Rendered => {
  const headerLine = source.split('\n').find((line) => line.trim()) ?? '';
  const type = headerLine.trim().split(/\s+/)[0] ?? 'unknown';
  try {
    const rows = renderMermaidASCII(source, { ...BASELINE_OPTIONS, useAscii }).split('\n').map(rtrim);
    while (rows.length && !rows[rows.length - 1]) rows.pop();
    while (rows.length && !rows[0]) rows.shift();
    if (rows.length === 0) return { type, reason: 'empty output' };
    return { type, body: rows.join('\n') };
  } catch (err) {
    return { type, reason: firstErrorLine(err) };
  }
};

const main = () => {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < NODE_MAJOR_REQUIRED) {
    done({ systemMessage: `${PLUGIN}: Node ${NODE_MAJOR_REQUIRED} or newer required (found v${process.versions.node}), diagram not rendered.` });
  }

  const input = parseStdin();
  const reply = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '';
  const blocks = extractDiagramBlocks(reply);
  if (blocks.length === 0) done({});

  const useAscii = isFlagSet(process.env['MERMAID_FOR_CLAUDE_ASCII']);
  const parts = blocks.map((source, index) => {
    const position = `${index + 1}/${blocks.length}`;
    const rendered = renderBlock(source, useAscii);
    return 'body' in rendered
      ? `${PLUGIN}: diagram ${position} (${rendered.type})\n${rendered.body}`
      : `${PLUGIN}: could not render diagram ${position} (${rendered.type}): ${rendered.reason}`;
  });
  done({ systemMessage: parts.join(SEPARATOR) });
};

try {
  main();
} catch (err) {
  process.stderr.write(`${PLUGIN}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  done({ systemMessage: `${PLUGIN}: internal error: ${firstErrorLine(err)}` });
}
