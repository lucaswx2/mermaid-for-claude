// The header read every block gets before anything renders (ADR-0006 rules): the metadata every mermaid
// type accepts comes off, then the header token picks the type table entry. Kept apart from the dispatcher
// because the main thread names a block it never rendered (the worker's `start` message, a block the
// deadline never let through) and must not load the renderer bundle to do so.
import { DIAGRAM_TYPES, diagramTypeKey } from './diagram-types.js';
import { rtrim } from './text.js';

// A `---` block at the very start, and `%%{ ... }%%` directives anywhere, multi-line included.
const FRONT_MATTER = /^\s*---\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
const DIRECTIVE = /%%\{[\s\S]*?\}%%/g;
const COMMENT_LINE = /^\s*%%/;

// accTitle / accDescr are accessibility metadata every diagram type accepts; no renderer sees them. The
// baseline renderer would otherwise draw `accTitle: x` as a flowchart node.
const withoutAccessibility = (lines: string[]) => {
  const kept: string[] = [];
  let inDescrBlock = false;
  for (const line of lines) {
    const text = line.trim();
    if (inDescrBlock) {
      if (text.includes('}')) inDescrBlock = false;
      continue;
    }
    if (/^accTitle\s*:/i.test(text) || /^accDescr\s*:/i.test(text)) continue;
    if (/^accDescr\s*\{/i.test(text)) {
      inDescrBlock = !text.includes('}');
      continue;
    }
    kept.push(line);
  }
  return kept;
};

// Front matter, directives, comment lines, blank lines and accessibility lines come off before the header
// is read: the baseline renderer rejects front matter and multi-line directives outright, and for every
// type but flowchart and state it also rejects a comment or one-line directive ahead of the header.
const stripMetadata = (source: string) => {
  const text = source.replace(/\r\n?/g, '\n').replace(FRONT_MATTER, '').replace(DIRECTIVE, '');
  const lines = withoutAccessibility(text.split('\n').map(rtrim).filter((line) => line.trim() && !COMMENT_LINE.test(line)));
  return { headerLine: (lines[0] ?? '').trim(), lines: lines.slice(1) };
};

// A colon right after the header token closes the type declaration in mermaid's grammar (`gitGraph:`,
// `gitGraph :`, `radar-beta:`), so it is not part of the header's arguments and comes off once here: the
// type table already ignored it when picking the entry, but the built-in renderers read the header line
// itself and rejected `gitGraph:` as an unsupported line (#38). A colon after an argument stays, because
// there mermaid makes it the declaration's own terminator (`gitGraph LR:`) and the renderer expects it.
const withoutTokenColon = (headerLine: string) => headerLine.replace(/^(\S+)\s*:(?=\s|$)/, '$1');

export const readHeader = (source: string) => {
  const { headerLine: rawHeaderLine, lines } = stripMetadata(source);
  const headerLine = withoutTokenColon(rawHeaderLine);
  const token = headerLine.split(/\s+/)[0] ?? '';
  return { headerLine, lines, token, entry: DIAGRAM_TYPES[diagramTypeKey(token)] };
};

// The canonical type name a notice prints for a block that was not rendered here: the same name a
// rendered block would carry (`graph` is `flowchart`, front matter and directives do not count).
export const diagramTypeNameOf = (source: string) => {
  const { token, entry } = readHeader(source);
  return entry?.name ?? (token || 'unknown');
};
