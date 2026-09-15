// The glyph table every built-in renderer draws with (ADR-0004): a Unicode set and an ASCII set with the
// same keys, picked by MERMAID_FOR_CLAUDE_ASCII. No emoji in either: double-width glyphs break columns.
export type Glyphs = {
  bar: string;
  barEmpty: string;
  dot: string;
  dotEmpty: string;
  ellipsis: string;
  horizontal: string;
  vertical: string;
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  treeTee: string;
  treeLast: string;
  treeBar: string;
};

const UNICODE_GLYPHS: Glyphs = {
  bar: '█',
  barEmpty: '░',
  dot: '●',
  dotEmpty: '○',
  ellipsis: '…',
  horizontal: '─',
  vertical: '│',
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  treeTee: '├── ',
  treeLast: '└── ',
  treeBar: '│   ',
};

const ASCII_GLYPHS: Glyphs = {
  bar: '#',
  barEmpty: '.',
  dot: '*',
  dotEmpty: 'o',
  ellipsis: '...',
  horizontal: '-',
  vertical: '|',
  topLeft: '+',
  topRight: '+',
  bottomLeft: '+',
  bottomRight: '+',
  treeTee: '|-- ',
  treeLast: '`-- ',
  treeBar: '|   ',
};

export const glyphsFor = (useAscii: boolean) => (useAscii ? ASCII_GLYPHS : UNICODE_GLYPHS);
