# Research: terminal rendering for the remaining mermaid diagram types (issue #4)

Scope: pie, gantt, mindmap, gitGraph, journey, timeline, quadrantChart, requirementDiagram, C4,
sankey, block, packet, kanban, architecture, radar, treemap, zenuml — everything
`beautiful-mermaid` (our baseline renderer for flowchart/sequence/state/class/ER/xychart) does
not cover. Constraint: Node >= 20, no browser, no network, cheapest useful output wins.

## Survey of existing tools

| Tool | Runtime | License | Last release | Diagram types | Runs in Node w/o DOM | Verdict |
|---|---|---|---|---|---|---|
| [`mermaid2term`](https://github.com/watzon/mermaid2term) ([npm](https://www.npmjs.com/package/mermaid2term)) | Node/TS | MIT | npm `0.1.0`, 2 stars, minimal community | flowchart + basic sequence only | Yes (built for Node/terminal) | Not useful here — doesn't touch any of the 17 types in scope |
| [`mermaid-ascii` (anishlakhwara)](https://github.com/anishlakhwara/mermaid-ascii) ([npm](https://www.npmjs.com/package/mermaid-ascii)) | Node/TS | MIT | npm `1.0.0`, published 2025-09-24 | flowcharts only (confirmed from npm registry README) | Yes | Not useful here — flowchart only |
| [`AlexanderGrooff/mermaid-ascii`](https://github.com/AlexanderGrooff/mermaid-ascii) / [`pgavlin/mermaid-ascii`](https://github.com/pgavlin/mermaid-ascii) | **Go** (not Node) | see repo (not confirmed MIT/other from fetch) | pgavlin fork: 236 commits, actively built; upstream latest tag `0.6.1` (2025-07-14) per [releases](https://github.com/AlexanderGrooff/mermaid-ascii/releases) | pgavlin's fork claims **22 types** incl. gantt, mindmap, gitGraph, journey, quadrant, C4, requirement, block, sankey, packet, kanban, architecture, zenUML (per [pkg.go.dev](https://pkg.go.dev/github.com/pgavlin/mermaid-ascii) subpackages: `c4`, `architecture`, `sankey`, etc.) | **No** — Go binary, not embeddable in a Node hook without shelling out to a compiled binary (against "no network, no browser" spirit but also adds a Go toolchain/binary dependency) | Ideas-only source: its per-type layout choices are the best reference we found for how to lay out gantt/mindmap/gitGraph/block/kanban as text |
| [`fasouto/termaid`](https://github.com/fasouto/termaid) ([PyPI](https://pypi.org/project/termaid/)) | **Python** (not Node) | MIT | 433 stars, 24 forks, 126 commits, actively maintained, has online demo (termaid.com) | **18 types**: flowchart, sequence, class, ER, state, block, gitGraph, gantt, architecture, pie, treemap, mindmap, timeline, kanban, quadrant, xychart, journey, packet | **No** — pure Python, would need a subprocess/Python runtime, breaking "don't leave Node" | Best ideas-only source. Its documented approach: pie → horizontal labelled bars, mindmap → indented tree with left-overflow, gitGraph → branch/commit graph (LR default), journey → rows with 😞–😄 satisfaction emoji. This directly validates the hand-roll sketches below. |
| npm search ("mermaid ascii", "mermaid terminal", "mermaid text", "cli-mermaid") | — | — | — | — | — | No further Node-native ASCII renderers found beyond the three above and `beautiful-mermaid` itself. |

Conclusion: **no existing Node-compatible library renders any of the 17 remaining types.**
Every option that covers them (pgavlin's Go fork, termaid in Python) requires leaving Node, which
violates the plugin's "100% local Node script, no other runtime" design. They are useful only as
design references for the hand-rolled renderers below.

## Can `@mermaid-js/parser` give us a free AST?

Tested directly (Node 24, package published **2026-09-09/10**, scratch project at
`research/parser-spike/`, `npm i @mermaid-js/parser` → resolved to **`2.0.0`**,
[npm](https://www.npmjs.com/package/@mermaid-js/parser)). It is langium-based
(confirmed by [mermaid-js/mermaid#4401](https://github.com/mermaid-js/mermaid/issues/4401), the
issue that tracks the jison→langium rewrite) and is a pure JS/TS parser with **no DOM
dependency** — it parsed fine in a plain Node script with zero browser APIs touched.

Grammar folders present in the parser's source
(`packages/parser/src/language/` on the `develop` branch,
https://github.com/mermaid-js/mermaid/tree/develop/packages/parser/src/language) are:
`architecture`, `common`, `cynefin`, `eventmodeling`, `gitGraph`, `info`, `packet`, `pie`,
`radar`, `railroad-{abnf,ebnf,peg}`, `treeView`, `treemap`, `wardley`.

So, of the 17 types in scope, `@mermaid-js/parser` **already has a native, DOM-free AST** for:
**pie, gitGraph, packet, architecture, radar, treemap**. It does **not** cover gantt, mindmap,
journey, timeline, quadrantChart, requirementDiagram, C4, sankey, block, kanban, zenuml — those
diagram types are still parsed by the legacy jison grammars bundled inside the main `mermaid`
package, which is not exposed as a standalone AST-only entry point
(confirmed: `mermaid`'s own `mermaidAPI`/`mermaid.parse` render path needs a browser DOM to
build SVG — see [mermaid-js/mermaid#3886](https://github.com/mermaid-js/mermaid/issues/3886),
"the mermaid library requires a browser DOM to create the SVG... not possible to create SVG from
mermaid diagram source outside the browser (server side)"; workarounds people use are a headless
Chromium (`headless-mermaid`) or full DOM shims, both against the "no browser" constraint).

### Actual parse output (from `research/parser-spike/spike.mjs`)

Pie (`pie title Pets\n "Dogs":40\n "Cats":30\n "Birds":30`) parses to:
```json
{ "$type": "Pie", "title": "Pets",
  "sections": [ {"label":"Dogs","value":40}, {"label":"Cats","value":30}, {"label":"Birds","value":30} ],
  "showData": false }
```

gitGraph (`commit; branch develop; checkout develop; commit; checkout main; merge develop`)
parses to:
```json
{ "$type": "GitGraph", "statements": [
  {"$type":"Commit","tags":[]},
  {"$type":"Branch","name":"develop"},
  {"$type":"Checkout","branch":"develop"},
  {"$type":"Commit","tags":[]},
  {"$type":"Checkout","branch":"main"},
  {"$type":"Merge","branch":"develop","tags":[]}
]}
```
(Langium AST nodes carry `$container`/`$cstNode` back-references that need stripping before
`JSON.stringify` — trivial replacer function, see spike script.)

**Practical takeaway:** for pie, gitGraph, packet, radar, treemap, and architecture, skip
hand-rolled regex parsing entirely — call `parse(type, text)` from `@mermaid-js/parser` and
render straight from the typed AST. For the other 11 types, a lightweight hand-rolled line parser
is still needed (mermaid's own jison grammars aren't consumable standalone).

## Per-type recommendation

| Type | Option | Engine / sketch | Cost | Source |
|---|---|---|---|---|
| **pie** | Hand-roll | `@mermaid-js/parser` AST → labelled horizontal bars, `%` computed from values. ```Dogs  ████████████████ 40%\nCats  ████████████     30%\nBirds ████████████     30%``` | **S** | AST verified above; approach matches [termaid's pie rendering](https://github.com/fasouto/termaid) |
| **gantt** | Hand-roll | No native AST (jison-only). Small line parser for `section`/`taskname :status, id, start, duration` → rows with date-scaled bar. ```Design    |███████░░░░░░| Sep 1-7\nBuild     |░░░███████░░░| Sep 5-12\nTest      |░░░░░░░░░████| Sep 10-14``` | **M** (date/duration parsing, scaling) | No Node tool covers this; layout idea from [termaid](https://github.com/fasouto/termaid)/[pgavlin gantt](https://pkg.go.dev/github.com/pgavlin/mermaid-ascii) |
| **mindmap** | Hand-roll | Indentation is already the mermaid source's structure; walk indentation levels → indented tree. ```Root\n├─ Idea A\n│  └─ Sub A1\n└─ Idea B``` | **S** | No native AST; [termaid](https://github.com/fasouto/termaid) documents the same "indented tree, overflow left" approach |
| **gitGraph** | Native AST | `@mermaid-js/parser` gives `statements[]` (Commit/Branch/Checkout/Merge) directly (verified above) → linear commit log grouped by branch. ```main:    o──o───────o (merge develop)\ndevelop:     └─o──o──┘``` | **S** | AST verified above |
| **journey** | Hand-roll | Small line parser for `section`/`task: score: actor` → rows with satisfaction bar/emoji. ```Book flight    🙂 [You]\nCheck in       😐 [You]\nBoard          😀 [You, Agent]``` | **S/M** | No native AST; emoji-score idea from [termaid](https://github.com/fasouto/termaid) |
| **timeline** | Hand-roll | Line parser for `section`/`period : event` → one row per period. ```2023 : Launch\n2024 : Series A, New office\n2025 : IPO``` | **S** | No native AST; row layout is the natural fit, same family as gantt/journey |
| **quadrantChart** | Hand-roll | Parse `x-axis`/`y-axis`/quadrant labels + point coordinates → fixed-size ASCII 2×2 grid, points placed by nearest cell + label. | **M** (coordinate → grid-cell math, label collision) | No native AST, no tool found with a text quadrant renderer; layout is novel |
| **requirementDiagram** | Notice-only for v1 | Requirement boxes + typed relationships (`satisfies`, `derives`, `traces`...) need a real graph layout to stay readable as text; a naive list loses the relationships, which is the whole point of the diagram. | — | Only pgavlin's Go fork claims support ([pkg.go.dev](https://pkg.go.dev/github.com/pgavlin/mermaid-ascii)); no Node reference exists |
| **C4** | Notice-only for v1 | Same problem as requirementDiagram plus nested boundaries (Person/System/Container/Component + relationships) — a faithful text layout is a small layout-engine project, not a cheap add. | — | pgavlin has a dedicated [`c4` Go package](https://pkg.go.dev/github.com/pgavlin/mermaid-ascii/pkg/c4) confirming this needs real engineering, not a quick hand-roll |
| **sankey** | Notice-only for v1 | Needs proportional-width flow layout (node ordering, flow crossing minimization) to be useful; a naive version would just be a confusing list of numbers. | — | pgavlin has a dedicated [`sankey` Go package](https://pkg.go.dev/github.com/pgavlin/mermaid-ascii/pkg/sankey) — real layout work, not S/M |
| **block** | Hand-roll | Parse block/grid declarations (`columns N`, block ids) → simple grid of `[box]` cells sized to content, one row per mermaid row. | **M** (grid sizing across variable block spans) | No native AST; [termaid](https://github.com/fasouto/termaid) and pgavlin both support block, confirming a grid-of-boxes approach is viable |
| **packet** | Native AST | `@mermaid-js/parser` has a `packet` grammar (confirmed from source tree) → render as a fixed-width bit-field ASCII table (classic "packet diagram" style, one row per byte range). | **S** | AST availability confirmed above (source tree listing) |
| **kanban** | Hand-roll | Parse `section`/task lines → N side-by-side columns of boxed task labels. ```[ To Do ]   [ Doing ]   [ Done ]\n Task A      Task C       Task E\n Task B                   Task F``` | **S** | No native AST; [termaid](https://github.com/fasouto/termaid) supports kanban with the same column layout |
| **architecture** | Notice-only for v1 (AST exists, layout doesn't) | `@mermaid-js/parser` has an `architecture` grammar (confirmed), so getting groups/services/edges as data is free — but rendering icons + groups + directional edges as readable text is a real 2D layout problem, same class as C4/sankey. | — | AST confirmed above; pgavlin has a dedicated [`architecture` Go package](https://pkg.go.dev/github.com/pgavlin/mermaid-ascii/pkg/architecture) showing it needs a real renderer |
| **radar** | Hand-roll | `@mermaid-js/parser` has a `radar` grammar (confirmed) → render as one labelled bar per axis (skip the actual polygon geometry, it's not worth it in a terminal). ```Speed    ████████░░ 8\nPower    ██████░░░░ 6\nControl  █████████░ 9``` | **S** (AST is free; the "spider" shape is skipped in favor of the pie-bar trick) | AST confirmed above |
| **treemap** | Hand-roll | `@mermaid-js/parser` has a `treemap` grammar (confirmed) → render as an indented list with `(value, % of parent)` per node instead of proportional nested boxes (proportional box layout is not worth it in monospace text). | **M** (AST is free; nested-percentage formatting is the remaining work) | AST confirmed above |
| **zenuml** | Notice-only for v1 | Niche diagram type (an alternate sequence-diagram DSL bundled in mermaid); no native AST, no Node tool, no Go/Python tool in our survey claims support beyond pgavlin's blanket "22 types" list which doesn't detail it. Low value for the likely long tail of effort. | — | Absence from survey; not found in `@mermaid-js/parser` grammar list above |

## How often do these types appear in the wild?

**UNVERIFIED** — no primary telemetry (GitHub code search stats, npm download-weighted survey,
or an official mermaid usage report) was found via web search. The closest proxies found:
- `termaid`'s and pgavlin's tool authors chose to support pie/gantt/mindmap/gitGraph/journey/
  timeline/quadrant/kanban/architecture/block/sankey/packet/treemap first, which is a weak signal
  that these are the types real users ask for enough to justify building support — but this is
  the tool authors' judgment, not measured usage data. **UNVERIFIED** as actual frequency.
- No data was found (or looked for further, given time budget) on requirementDiagram, C4,
  radar, or zenuml popularity specifically.

## Final recommendation

**Hand-roll for v1** (all S or S/M cost, no dependency on an unreleased/unstable AST, or a free
AST from `@mermaid-js/parser` plus a small renderer): **pie, gitGraph, mindmap, journey,
timeline, kanban, packet, radar**. These are cheap (labelled bars / indented tree / rows /
columns / bit table) and cover the types the surveyed tools (termaid, pgavlin) chose to prioritize
first, which is the best available (if unverified) signal for real-world demand.

**Worth hand-rolling but slightly pricier (M):** **gantt, quadrantChart, block, treemap** — still
just row/grid/list rendering with some extra parsing or math, no real layout engine needed.

**Notice-only for v1** (render nothing but tell the user "unsupported diagram type: X, showing
raw source" or similar): **requirementDiagram, C4, sankey, architecture, zenuml**. The first
four need actual 2D graph/flow layout to be useful — a naive text dump would misrepresent the
diagram's whole point (relationships/proportional flow/nesting), so it's not "cheap" by the
issue's own bar. `architecture` gets a free AST from `@mermaid-js/parser` but still needs the
same layout work as the others — worth revisiting once a real layout primitive exists in the
plugin (e.g. reused from whatever block/quadrant grid code gets built for the M-tier types).
`zenuml` is notice-only purely on low expected value (niche, unsupported by any surveyed tool).

## Parser findings summary

- `@mermaid-js/parser` (npm, MIT, langium-based, current `2.0.0` as of 2026-09-10) parses **pie,
  gitGraph, packet, architecture, radar, treemap** (plus `info`, `cynefin`, `eventmodeling`,
  `wardley`, `railroad-*`, none of which are in scope) with **no DOM dependency** — verified live
  in `research/parser-spike/spike.mjs` inside this worktree (not committed: `node_modules/`).
- It does **not** parse gantt, mindmap, journey, timeline, quadrantChart, requirementDiagram, C4,
  sankey, block, kanban, zenuml — those remain jison-only inside the main `mermaid` package.
- `mermaid`'s own `mermaidAPI`/`mermaid.parse` rendering path needs a browser DOM to produce SVG
  (confirmed via [mermaid-js/mermaid#3886](https://github.com/mermaid-js/mermaid/issues/3886));
  it is not usable headless in Node for the remaining 11 types without a headless browser, which
  is out of scope for this plugin.
