// Stop hook entry point (ADR-0001): reads the hook JSON from stdin, renders every diagram block of the
// reply and writes the systemMessage payload to stdout. Every failure it can see becomes a notice.
import { readFileSync } from 'node:fs';
import { renderMermaidASCII } from 'beautiful-mermaid';

const PLUGIN_NAME = 'mermaid-for-claude';
const SEPARATOR = '\n\n';
const NODE_MAJOR_REQUIRED = 20;
// Compact padding (ADR-0005); no colour because systemMessage shows none (ADR-0002).
const BASELINE_OPTIONS = { colorMode: 'none', paddingY: 3, paddingX: 3, boxBorderPadding: 0 } as const;
// A ```mermaid fence, possibly indented inside a list item; the body is dedented by that indentation.
const MERMAID_FENCE = /^([ \t]*)```mermaid[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

type HookOutput = { systemMessage?: string };
type Rendered = { kind: 'diagram'; type: string; body: string } | { kind: 'notice'; type: string; reason: string };

// Env var truthiness (ticket #8): unset, empty, 0 and false are off; anything else is on.
const isFlagSet = (value: string | undefined) => value !== undefined && !['', '0', 'false'].includes(value);

const firstErrorLine = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0]?.slice(0, 100) ?? 'unknown error';
};

const logTrace = (context: string, err: unknown) => {
  process.stderr.write(`${PLUGIN_NAME}: ${context}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
};

const readReplyFromStdin = () => {
  try {
    const hookInput: unknown = JSON.parse(readFileSync(0, 'utf8'));
    if (typeof hookInput !== 'object' || hookInput === null || !('last_assistant_message' in hookInput)) return '';
    return typeof hookInput.last_assistant_message === 'string' ? hookInput.last_assistant_message : '';
  } catch (err) {
    logTrace('could not parse the hook input', err);
    return '';
  }
};

const extractDiagramBlocks = (reply: string) =>
  [...reply.replace(/\r\n?/g, '\n').matchAll(MERMAID_FENCE)].map(([, indent = '', body = '']) => {
    const dedent = new RegExp(`^[ \\t]{0,${indent.length}}`);
    return body
      .split('\n')
      .map((line) => line.replace(dedent, ''))
      .join('\n');
  });

const renderBlock = (source: string, useAscii: boolean): Rendered => {
  const headerLine = source.split('\n').find((line) => line.trim()) ?? '';
  const type = headerLine.trim().split(/\s+/)[0] ?? 'unknown';
  try {
    const lines = renderMermaidASCII(source, { ...BASELINE_OPTIONS, useAscii })
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''));
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    while (lines.length && !lines[0]) lines.shift();
    if (lines.length === 0) return { kind: 'notice', type, reason: 'empty output' };
    return { kind: 'diagram', type, body: lines.join('\n') };
  } catch (err) {
    logTrace(`rendering a ${type} block failed`, err);
    return { kind: 'notice', type, reason: firstErrorLine(err) };
  }
};

const sectionFor = (rendered: Rendered, position: string) =>
  rendered.kind === 'diagram'
    ? `${PLUGIN_NAME}: diagram ${position} (${rendered.type})\n${rendered.body}`
    : `${PLUGIN_NAME}: could not render diagram ${position} (${rendered.type}): ${rendered.reason}`;

const buildHookOutput = (): HookOutput => {
  if (isFlagSet(process.env['MERMAID_FOR_CLAUDE_DISABLE'])) return {};

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < NODE_MAJOR_REQUIRED) {
    return { systemMessage: `${PLUGIN_NAME}: Node ${NODE_MAJOR_REQUIRED} or newer required (found v${process.versions.node}), diagram not rendered.` };
  }

  const blocks = extractDiagramBlocks(readReplyFromStdin());
  if (blocks.length === 0) return {};

  const useAscii = isFlagSet(process.env['MERMAID_FOR_CLAUDE_ASCII']);
  const sections = blocks.map((source, index) => sectionFor(renderBlock(source, useAscii), `${index + 1}/${blocks.length}`));
  return { systemMessage: sections.join(SEPARATOR) };
};

const hookOutput = (() => {
  try {
    return buildHookOutput();
  } catch (err) {
    logTrace('internal error', err);
    return { systemMessage: `${PLUGIN_NAME}: internal error: ${firstErrorLine(err)}` };
  }
})();

// No process.exit after the write: on a pipe stdout is asynchronous and exit could truncate the payload.
process.stdout.write(JSON.stringify(hookOutput));
