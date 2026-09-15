// Finds every ```mermaid fence in a reply. A fence indented inside a list item is found too and its
// body is dedented by the opening fence's indentation.
const FENCE = /^([ \t]*)```mermaid[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

export const extractDiagramBlocks = (reply: string): string[] =>
  [...reply.replace(/\r\n?/g, '\n').matchAll(FENCE)].map(([, indent = '', body = '']) => {
    const dedent = new RegExp(`^[ \\t]{0,${indent.length}}`);
    return body
      .split('\n')
      .map((line) => line.replace(dedent, ''))
      .join('\n');
  });
