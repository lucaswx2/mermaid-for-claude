---
status: accepted
---

# Built-in renderers cover the types the baseline renderer lacks; no mermaid parser dependency

`beautiful-mermaid` draws six diagram types and mermaid defines seventeen more; no Node library renders any of those seventeen as text (research ticket #4). Decided in wayfinder ticket #10: twelve of them get a built-in renderer written in this plugin, each with its own small line parser, drawing with rows, bars and trees instead of geometry: pie, gitGraph, mindmap, journey, timeline, kanban, packet, radar, gantt, quadrantChart, block, treemap. Five stay notice-only: requirementDiagram, C4, sankey, architecture, zenuml. Those need a two-dimensional layout engine to keep their point, and a list of nodes and relations would misrepresent them. `@mermaid-js/parser` was rejected although it gives a DOM-free AST for pie, gitGraph, packet, radar, treemap and architecture: bundled with esbuild it adds 670 KB minified and about 190 ms of cold start per render on the maintainer's Windows machine, and seven of the twelve types would still need a parser of their own.

## Consequences

- Each built-in renderer supports a documented subset of its type's grammar. A construct outside the subset produces a one-line notice and no diagram, never a partial one; this differs from the baseline renderer, which degrades silently on malformed input (ADR-0002).
- No emoji in any output: double-width glyphs break column alignment. `MERMAID_FOR_CLAUDE_ASCII=1` applies to built-in renderers as well as the baseline renderer.
- A type becomes a recommended type in the context line only after a prototype run the maintainer accepts; until then the context line says it renders as simple text.
- Upstream mermaid grammar changes must be tracked by hand; there is no parser package to update.
- The dispatcher owns the header parse for every renderer: aliases (`graph`), `-beta` suffixes, front matter and `%%{init}%%` directives before the header.
