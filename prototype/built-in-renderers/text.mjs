// PROTOTYPE - throwaway. Wayfinder ticket #13. Shared text helpers for the built-in renderers.
// Widths are measured in code points (ADR-0005); emoji are banned so no wide-glyph handling.

export class RenderError extends Error {}

export const fail = (reason) => {
  throw new RenderError(reason);
};

export const cps = (s) => [...String(s)];
export const len = (s) => cps(s).length;
export const rtrim = (s) => s.replace(/\s+$/, '');
export const padEnd = (s, n) => s + ' '.repeat(Math.max(0, n - len(s)));
export const padStart = (s, n) => ' '.repeat(Math.max(0, n - len(s))) + s;
export const center = (s, n) => {
  const gap = Math.max(0, n - len(s));
  const left = Math.floor(gap / 2);
  return ' '.repeat(left) + s + ' '.repeat(gap - left);
};
export const widest = (lines) => Math.max(0, ...lines.map(len));
export const cut = (s, n, g) =>
  len(s) <= n ? s : cps(s).slice(0, Math.max(0, n - len(g.ellipsis))).join('') + g.ellipsis;

// mermaid labels use <br/> for line breaks; render them as real line breaks.
export const breaks = (s) => String(s).replace(/<br\s*\/?>/gi, '\n');

// Greedy word wrap; a single word longer than `width` is hard-split.
export const wrap = (text, width) => {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const pieces = [];
      let rest = cps(word);
      while (rest.length > width) {
        pieces.push(rest.slice(0, width).join(''));
        rest = rest.slice(width);
      }
      pieces.push(rest.join(''));
      for (const piece of pieces) {
        if (!line) line = piece;
        else if (len(line) + 1 + len(piece) <= width) line += ' ' + piece;
        else {
          out.push(line);
          line = piece;
        }
      }
    }
    out.push(line);
  }
  return out;
};

// Glyph table; ASCII stand-ins for every box glyph when MERMAID_FOR_CLAUDE_ASCII=1.
export const glyphs = (ascii) =>
  ascii
    ? {
        h: '-', v: '|', tl: '+', tr: '+', bl: '+', br: '+', tj: '+', bj: '+', lj: '+', rj: '+', x: '+',
        bar: '#', barEmpty: '.', dot: '*', dotEmpty: 'o', ellipsis: '...',
        commit: 'o', merge: 'M', highlight: '*', reverse: 'x',
        treeTee: '|-- ', treeLast: '`-- ', treeBar: '|   ',
      }
    : {
        h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘', tj: '┬', bj: '┴', lj: '├', rj: '┤', x: '┼',
        bar: '█', barEmpty: '░', dot: '●', dotEmpty: '○', ellipsis: '…',
        commit: '●', merge: '◆', highlight: '◉', reverse: '⊗',
        treeTee: '├── ', treeLast: '└── ', treeBar: '│   ',
      };

const JUNCTIONS = {
  udlr: 'x', udl: 'rj', udr: 'lj', ud: 'v', ulr: 'bj', ul: 'br', ur: 'bl', dlr: 'tj', dl: 'tr', dr: 'tl',
  lr: 'h', u: 'v', d: 'v', l: 'h', r: 'h',
};

// Box-drawing junction from the four directions a line leaves it in.
export const junction = (g, { up, down, left, right }) => {
  const key = `${up ? 'u' : ''}${down ? 'd' : ''}${left ? 'l' : ''}${right ? 'r' : ''}`;
  return key ? g[JUNCTIONS[key]] : ' ';
};
