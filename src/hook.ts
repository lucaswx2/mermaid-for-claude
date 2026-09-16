// Stop hook entry point (ADR-0001): reads the hook JSON from stdin, renders every diagram block of the
// reply and writes the systemMessage payload to stdout. Every failure it can see becomes a notice.
import { readFileSync } from 'node:fs';
import { assemblePayload } from './output-budget.js';
import { elapsedSinceBundleStart, renderWithDeadline } from './render-deadline.js';
import { measureTerminalWidth, type TerminalWidth } from './terminal-width.js';
import { timingLineFor } from './timing-line.js';
import { firstErrorLine, logTrace, PLUGIN_NAME } from './trace.js';
import { enforceWidthLimit, positiveInteger, widthLimitFor } from './width-limit.js';

const NODE_MAJOR_REQUIRED = 20;
// A ```mermaid fence, possibly indented inside a list item; the body is dedented by that indentation.
const MERMAID_FENCE = /^([ \t]*)```mermaid[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

type HookOutput = { systemMessage?: string };

// Env var truthiness (ticket #8): unset, empty, 0 and false are off; anything else is on.
const isFlagSet = (value: string | undefined) => value !== undefined && !['', '0', 'false'].includes(value);

// The reply to render and the session the terminal measurement is cached under (ADR-0008).
const readHookInput = () => {
  const empty = { reply: '', sessionId: '' };
  try {
    const hookInput: unknown = JSON.parse(readFileSync(0, 'utf8'));
    if (typeof hookInput !== 'object' || hookInput === null) return empty;
    const reply = 'last_assistant_message' in hookInput && typeof hookInput.last_assistant_message === 'string' ? hookInput.last_assistant_message : '';
    const sessionId = 'session_id' in hookInput && typeof hookInput.session_id === 'string' ? hookInput.session_id : '';
    return { reply, sessionId };
  } catch (err) {
    logTrace('could not parse the hook input', err);
    return empty;
  }
};

const extractDiagramBlocks = (reply: string) =>
  [...reply.replace(/\r\n?/g, '\n').matchAll(MERMAID_FENCE)].map(([, indent = '', body = '']) => {
    const dedent = new RegExp(`^[ \t]{0,${indent.length}}`);
    return body
      .split('\n')
      .map((line) => line.replace(dedent, ''))
      .join('\n');
  });

const buildHookOutput = async (): Promise<HookOutput> => {
  if (isFlagSet(process.env['MERMAID_FOR_CLAUDE_DISABLE'])) return {};

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < NODE_MAJOR_REQUIRED) {
    return { systemMessage: `${PLUGIN_NAME}: Node ${NODE_MAJOR_REQUIRED} or newer required (found v${process.versions.node}), diagram not rendered.` };
  }

  const { reply, sessionId } = readHookInput();
  const blocks = extractDiagramBlocks(reply);
  if (blocks.length === 0) return {};

  // The override wins (ADR-0005), so a session that sets it never pays for measuring the terminal.
  const overrideLimit = positiveInteger(process.env['MERMAID_FOR_CLAUDE_MAX_WIDTH']);
  const terminal = overrideLimit === undefined ? measureTerminalWidth(sessionId) : ({ source: 'none' } satisfies TerminalWidth);
  const renderOptions = {
    useAscii: isFlagSet(process.env['MERMAID_FOR_CLAUDE_ASCII']),
    widthLimit: overrideLimit ?? widthLimitFor(terminal),
  };
  const results = (await renderWithDeadline(blocks, renderOptions)).map((timed) => ({
    ...timed,
    rendered: enforceWidthLimit(timed.rendered, renderOptions.widthLimit),
  }));
  const systemMessage = assemblePayload(results.map(({ rendered }) => rendered));
  const timingLine = timingLineFor(results, { payloadLength: systemMessage.length, totalMs: elapsedSinceBundleStart(), options: renderOptions, terminal });
  process.stderr.write(`${timingLine}\n`);
  return { systemMessage };
};

const hookOutput = await (async () => {
  try {
    return await buildHookOutput();
  } catch (err) {
    logTrace('internal error', err);
    return { systemMessage: `${PLUGIN_NAME}: internal error: ${firstErrorLine(err)}` };
  }
})();

// No process.exit after the write: on a pipe stdout is asynchronous and exit could truncate the payload.
process.stdout.write(JSON.stringify(hookOutput));
