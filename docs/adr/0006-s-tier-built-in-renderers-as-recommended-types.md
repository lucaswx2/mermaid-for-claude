---
status: accepted
---

# The eight S-tier built-in renderers become recommended types; layouts, grammar subsets and dispatcher rules fixed

Wayfinder ticket #13 prototyped the eight S-tier built-in renderers from ADR-0004 (pie, gitGraph, mindmap, journey, timeline, kanban, packet, radar) behind the shared header dispatcher, on branch `prototype/built-in-renderers`. The maintainer delegated the verdict to the agent, which judged the rendered text in the shell (the same text the `Stop` `systemMessage` shows): every type reads well, keeps its point, keeps labels intact and fits the width limit, so all eight become recommended types in the context line. Layouts: pie is one full-width bar per slice with its percentage; gitGraph is git-log lanes top to bottom, one row per commit, labels on the right, direction ignored; mindmap is a tree with shapes stripped to text; journey is a five-dot score per task with actors on the right; timeline is one row per period with events beside it and sections as headings; kanban is boxed side-by-side columns with word-wrapped labels; packet is an RFC-style bit table, 32 bits per row (16 or 8 under narrower limits), a multi-row field drawn as one tall cell, tiny cells stacking letters vertically; radar is one bar column per curve with no polygon. Rejected: left-to-right git graphs (ids under commits collide across lanes and blow the width), a radar polygon (geometry adds nothing at terminal resolution), cutting kanban labels with `…` (wrapping keeps the label; the ADR-0005 example is superseded).

## Grammar subsets

- pie: `pie [showData] [title ...]`, `title ...`, `showData`, `"label" : number`.
- gitGraph: `gitGraph [LR:|TB:|BT:]`, `commit [id:] [tag:] [type: NORMAL|REVERSE|HIGHLIGHT]`, `branch <name> [order:]`, `checkout|switch <name>`, `merge <name> [id:] [tag:] [type:]`, `cherry-pick id: [parent:] [tag:]`.
- mindmap: one root, nesting by indentation, shapes `[ ]`, `( )`, `(( ))`, `)) ((`, `) (`, `{{ }}`, `<br/>` as a line break; `::icon(...)` and `:::class` ignored.
- journey: `title`, `section`, `task: score[: actor, actor]`.
- timeline: `title`, `section`, `period : event : event`, continuation lines starting with `:`.
- kanban: column at the first indentation level, item deeper, `id[label]`, `[label]`, plain text, optional `@{ ticket, assigned, priority }` shown under the item.
- packet: `packet` or `packet-beta`, `title`, `a-b: "label"`, `a: "label"`, `+n: "label"`; fields contiguous from bit 0.
- radar: `radar` or `radar-beta`, `title`, `axis id["label"], id`, `curve id["label"]{v, v}` or `{ axisId: v }`, `max`, `min`; `showLegend`, `graticule`, `ticks` ignored.

## Dispatcher rules

Front matter (`---` block) and `%%{ ... }%%` directives, multi-line included, come off before every renderer; `%%` comment lines, blank lines and `accTitle` / `accDescr` (block form too) are dropped. The header is the first token of the first remaining line, matched case-insensitively without a trailing `:` and without a `-beta` or `-v2` suffix; `graph` is flowchart; `C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment` are C4. `classDiagram-v2` is rewritten to `classDiagram` for the baseline renderer, which rejects it along with front matter and multi-line directives but accepts one-line directives and comments. Fences indented inside a list item are found and dedented. A line outside a renderer's subset gives the notice `unsupported line: <line>`.

## Consequences

- The context line's recommended list grows from five to thirteen types: flowchart, sequence, state, class, xychart plus pie, gitGraph, mindmap, journey, timeline, kanban, packet, radar. ER keeps "renders roughly"; gantt, quadrantChart, block and treemap say "renders as simple text" until ticket #14 lands.
- gitGraph direction is accepted and ignored; auto-generated commit ids are not printed; a lane ends after its last commit, last merge taken from it or last fork.
- Kanban columns are 10 to 28 characters wide; more columns than fit at the width limit give a notice rather than narrower columns.
- Packet rows shrink from 32 to 16 to 8 bits per row as the width limit shrinks; below 17 columns it gives a notice.
- The verdict was made on shell output, not on the TUI; the TUI run of these samples folds into ticket #15.
- The prototype is the reference implementation for the spec; the M-tier renderers (ticket #14) reuse its dispatcher, glyph table and text helpers.
