// Error reporting shared by the hook and the renderers: one line for the notice, the full trace on stderr.
export const PLUGIN_NAME = 'mermaid-for-claude';

export const firstErrorLine = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0]?.slice(0, 100) ?? 'unknown error';
};

export const logTrace = (context: string, err: unknown) => {
  process.stderr.write(`${PLUGIN_NAME}: ${context}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
};
