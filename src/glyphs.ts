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
  // Table junctions (packet, kanban, quadrantChart, gitGraph lanes).
  teeDown: string;
  teeUp: string;
  teeRight: string;
  teeLeft: string;
  cross: string;
  // gitGraph commit types.
  commit: string;
  commitMerge: string;
  commitHighlight: string;
  commitReverse: string;
  // gantt task states and markers.
  barDone: string;
  barActive: string;
  milestone: string;
  vertMarker: string;
  // block arrows and edges.
  arrowRight: string;
  arrowLeft: string;
  arrowUp: string;
  arrowDown: string;
  edgeArrow: string;
  edgeLine: string;
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
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
  cross: '┼',
  commit: '●',
  commitMerge: '◆',
  commitHighlight: '◉',
  commitReverse: '⊗',
  barDone: '░',
  barActive: '▒',
  milestone: '◆',
  vertMarker: '┆',
  arrowRight: '─▶',
  arrowLeft: '◀─',
  arrowUp: '▲',
  arrowDown: '▼',
  edgeArrow: '──▶',
  edgeLine: '───',
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
  teeDown: '+',
  teeUp: '+',
  teeRight: '+',
  teeLeft: '+',
  cross: '+',
  commit: 'o',
  commitMerge: 'M',
  commitHighlight: '*',
  commitReverse: 'x',
  barDone: '.',
  barActive: '=',
  milestone: '*',
  vertMarker: ':',
  arrowRight: '->',
  arrowLeft: '<-',
  arrowUp: '^',
  arrowDown: 'v',
  edgeArrow: '-->',
  edgeLine: '---',
};

export const glyphsFor = (useAscii: boolean) => (useAscii ? ASCII_GLYPHS : UNICODE_GLYPHS);

// The box-drawing glyph for a table junction, from the directions a line leaves it in.
const JUNCTIONS: Readonly<Record<string, keyof Glyphs>> = {
  udlr: 'cross',
  udl: 'teeLeft',
  udr: 'teeRight',
  ud: 'vertical',
  ulr: 'teeUp',
  ul: 'bottomRight',
  ur: 'bottomLeft',
  dlr: 'teeDown',
  dl: 'topRight',
  dr: 'topLeft',
  lr: 'horizontal',
  u: 'vertical',
  d: 'vertical',
  l: 'horizontal',
  r: 'horizontal',
};

export type JunctionArms = { up?: boolean; down?: boolean; left?: boolean; right?: boolean };

export const junction = (glyphs: Glyphs, arms: JunctionArms) => {
  const key = `${arms.up ? 'u' : ''}${arms.down ? 'd' : ''}${arms.left ? 'l' : ''}${arms.right ? 'r' : ''}`;
  const name = JUNCTIONS[key];
  return name ? glyphs[name] : ' ';
};
