// The seventeen recommended types named by the context line (spec #16), in the spec's order. The
// SessionStart script carries a second copy; a parity test keeps the two equal.
export const RECOMMENDED_TYPES = [
  'flowchart',
  'sequenceDiagram',
  'stateDiagram-v2',
  'classDiagram',
  'xychart-beta',
  'pie',
  'gitGraph',
  'mindmap',
  'journey',
  'timeline',
  'kanban',
  'packet',
  'radar',
  'gantt',
  'quadrantChart',
  'block',
  'treemap',
] as const;
