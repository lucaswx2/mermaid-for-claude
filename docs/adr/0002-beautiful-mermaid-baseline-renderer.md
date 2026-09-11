---
status: accepted
---

# `beautiful-mermaid` is the baseline renderer, shipped as one esbuild bundle

Diagram blocks are rendered by `renderMermaidASCII` from `beautiful-mermaid` (MIT), the only Node library found that draws flowchart, sequence, state, class, ER and xychart diagrams as text without a browser (research tickets #3 and #4). It is bundled with esbuild into a single minified ESM file committed to the plugin, so the user never runs `npm install`. Validated end to end on the maintainer's terminal (wayfinder ticket #7, branch `prototype/end-to-end`): all six types judged acceptable, ER the weakest.

## Consequences

- The bundle is about 1.5 MB because the package exposes a single entry point and drags `elkjs` in even though the text path never calls it.
- `colorMode` must be `none`: `systemMessage` shows no colour, and ANSI codes only inflate the payload.
- Malformed input inside a supported type can degrade silently to a near-empty diagram; the renderer throws only on an unknown header.
- Layout width is driven by label length; sequence diagrams with long participant names or messages exceed a normal terminal width.
