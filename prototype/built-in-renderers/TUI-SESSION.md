# TUI session for wayfinder ticket #15 (PROTOTYPE, throwaway)

Question: does the size policy (ADR-0005) hold up inside the Claude Code TUI, and do the twelve
built-in renderers (ADR-0006, ADR-0007) read well inside the `Stop says:` block?

Change made during this ticket: the width limit now follows the terminal. The hook reads the console
width (`CONOUT$` on Windows, `/dev/tty` elsewhere) and uses it minus the 4-column indent;
`MERMAID_FOR_CLAUDE_MAX_WIDTH` still overrides; 120 only when the console cannot be read. Every
`e2e.log` line records `terminal=<columns|none>` and `maxWidth=<limit>`: check it after P1.

## Setup

1. Terminal at least 130 columns wide (the `Stop says:` block is indented by 4 columns).
2. In the repo root, on branch `prototype/size-policy`:
   `cd prototype/built-in-renderers && npm ci && npm run build && cd ../..`
3. Start `claude` from the repo root. `.claude/settings.local.json` wires two hooks:
   `session-start.sh` (context line) and `stop.sh` (ADR-0003 wrapper in front of `bundle.mjs`).
4. Every hook fire appends one line to `prototype/built-in-renderers/e2e.log`.

Paste one prompt at a time and wait for the `Stop says:` block under the reply.

## P1 - baseline types, part 1 (compact padding)

```
Read these files in prototype/built-in-renderers/samples/: baseline-flowchart.mmd, baseline-sequence.mmd, baseline-state.mmd. Reply with the content of each file, in that order, each inside its own ```mermaid fence, and nothing else.
```

Expect headers `diagram 1/3 (flowchart)`, `diagram 2/3 (sequenceDiagram)`, `diagram 3/3 (stateDiagram)`.
Judge: boxes, arrows and labels readable with `paddingY: 3`, `paddingX: 3`, `boxBorderPadding: 0`?

## P2 - baseline types, part 2

```
Read these files in prototype/built-in-renderers/samples/: baseline-class.mmd, baseline-er.mmd, baseline-xychart.mmd. Reply with the content of each file, in that order, each inside its own ```mermaid fence, and nothing else.
```

Expect `classDiagram`, `erDiagram`, `xychart`. Judge the same way; ER is known to be rough.

## P3 - output budget cut

```
Read these files in prototype/built-in-renderers/samples/: baseline-flowchart.mmd, budget-big.mmd, budget-small.mmd. Reply with the content of each file, in that order, each inside its own ```mermaid fence, and nothing else.
```

Expect: diagram 1/3 rendered, then the one-line notice
`mermaid-for-claude: could not render diagram 2/3 (flowchart): output budget exhausted (9,800 chars per reply)`,
then diagram 3/3 rendered. Must not show `<persisted-output>` or "Output too large".

## P3b - render deadline (found while building this prototype)

```
Read these files in prototype/built-in-renderers/samples/: chain-30.mmd, budget-small.mmd. Reply with the content of each file, in that order, each inside its own ```mermaid fence, and nothing else.
```

A flowchart chain 26 or more nodes deep makes the baseline renderer run for about 20 s and then
throw; the hook is killed by Claude Code at 10 s. The prototype renders in a worker thread with a
3 s deadline per diagram. Expect about 3.5 s of wait, then
`mermaid-for-claude: could not render diagram 1/2 (flowchart): rendering took longer than 3 s`
and diagram 2/2 rendered. Must not show a `Stop hook` error line.

## P4 - close to the cap

```
Read these files in prototype/built-in-renderers/samples/: baseline-flowchart.mmd, budget-mid.mmd, baseline-sequence.mmd, baseline-state.mmd. Reply with the content of each file, in that order, each inside its own ```mermaid fence, and nothing else.
```

Expect all four rendered, about 9,250 characters in one block, no `<persisted-output>`.
Judge: is a block this tall still usable, or should the budget be lower?

## P5 - width notice

```
Read prototype/built-in-renderers/samples/sequence-wide.mmd and reply with its content inside a ```mermaid fence, nothing else.
```

Expect `mermaid-for-claude: could not render diagram 1/1 (sequenceDiagram): 208 columns wide, limit is N`,
with N = your terminal width minus 4 (120 if `e2e.log` says `terminal=none`).

## P6 - context line

```
What width limit does your context give for mermaid diagrams? Reply with the number only.
```

Expect the same N (terminal width minus 4 at session start; 120 if the console could not be read).

## P7 and P8 - width override

Leave the session (`/exit`). In PowerShell: `$env:MERMAID_FOR_CLAUDE_MAX_WIDTH = "220"`, then `claude` again.

- P7: paste P6 again. Expect `220`.
- P8: paste P5 again. Expect the sequence diagram rendered, 208 columns wide. With a terminal narrower
  than 212 columns its rows fold; note what that looks like (P9 covers it on purpose).

Then `/exit`, `Remove-Item Env:MERMAID_FOR_CLAUDE_MAX_WIDTH`, `claude` again.

## P9 - narrow terminal

Resize the terminal window to about 80 columns before pasting:

```
Read prototype/built-in-renderers/samples/gantt.mmd and reply with its content inside a ```mermaid fence, nothing else.
```

With width detection working, gantt fits itself into about 76 columns (time axis compressed) and
nothing folds; `e2e.log` shows `terminal=80` or so. If detection fails, the diagram is 120 columns
wide: record what the TUI does with rows wider than the window (fold, cut, scroll?), then widen the
window again and note whether the block repaints cleanly. A screenshot of each state helps.

Still at about 80 columns, paste P5 again: expect the width notice with `limit is 76` (or so).

## P10 to P12 - built-in renderers in the TUI

Terminal back to at least 130 columns.

P10:
```
Read these files in prototype/built-in-renderers/samples/: pie.mmd, git-graph.mmd, mindmap.mmd, journey.mmd. Reply with the content of each file, in that order, each inside its own ```mermaid fence, and nothing else.
```

P11:
```
Read these files in prototype/built-in-renderers/samples/: timeline.mmd, kanban.mmd, packet.mmd, radar.mmd. Reply with the content of each file, in that order, each inside its own ```mermaid fence, and nothing else.
```

P12:
```
Read these files in prototype/built-in-renderers/samples/: gantt.mmd, quadrant.mmd, block.mmd, treemap.mmd. Reply with the content of each file, in that order, each inside its own ```mermaid fence, and nothing else.
```

Judge each of the twelve as it appears in the dim `Stop says:` block. Anything that reads badly
there reopens that type's verdict (ADR-0006, ADR-0007).

## What to report

Per prompt: OK or not OK, and what looked wrong. Screenshots are welcome.
Decision to take at the end: keep or change 9,800 characters, the terminal-width limit (120 fallback),
"about 60 rows" in the context line, the compact padding values, and the 3 s render deadline (it costs
about 130 ms per reply with a diagram: the renderer runs in a worker thread).
