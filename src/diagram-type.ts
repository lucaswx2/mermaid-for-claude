// The type a notice names for a block the worker never rendered: first word of the header line. The
// dispatcher (render-block.ts) has its own reading of the header, and owns the type of a rendered block.
export const diagramTypeOf = (source: string) => {
  const headerLine = source.split('\n').find((line) => line.trim()) ?? '';
  return headerLine.trim().split(/\s+/)[0] ?? 'unknown';
};
