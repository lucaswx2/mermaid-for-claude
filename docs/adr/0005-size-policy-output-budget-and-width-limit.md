---
status: accepted
---

# Size policy: a per-reply output budget, a fixed width limit, compact padding

The `Stop` hook's `systemMessage` is capped at 10,000 characters (ADR-0001) and is drawn by an Ink `<Text>` with default wrapping, while the hook cannot see the terminal width: `COLUMNS` is not exported to hook processes and stdout is not a tty. Decided in wayfinder ticket #12: every reply's payload (headers, diagrams, notices) fits a 9,800-character output budget; diagrams render in order and each one is checked against the remaining budget; a diagram that does not fit is replaced by a one-line notice and the next one is still tried, so a small third diagram can follow a skipped huge second one. A diagram wider than the width limit, 120 columns by default and overridable with `MERMAID_FOR_CLAUDE_MAX_WIDTH`, is replaced by a notice too. The baseline renderer always runs with compact padding (`paddingY: 3`, `paddingX: 3`, `boxBorderPadding: 0`), about 35% fewer rows than its defaults with no loss the maintainer cared about (ticket #7). Built-in renderers receive the width limit as an input and fit inside it (gantt compresses its time scale, kanban narrows columns and cuts labels with `…`); they give a notice only when fitting is impossible. Rejected: truncating rows (a partial diagram misleads, the rule ADR-0004 already sets), writing the overflow to a file (a file nobody opens), no width limit (a wrapped diagram is unreadable in a narrow terminal), reading `COLUMNS` (never present), and trying default padding first (two looks for the same reply).

## Consequences

- A third environment variable exists, `MERMAID_FOR_CLAUDE_MAX_WIDTH`, reversing the "two env vars only" preference from ticket #8. It is the only way a wide terminal keeps wide diagrams, since width detection is impossible from a hook.
- The maintainer's own 208-column sequence diagram from ticket #7 becomes a notice until the variable is raised. The context line tells the model the effective limit so it writes narrower diagrams.
- Notices follow the ADR-0004 format: `could not render diagram i/N (type): 208 columns wide, limit is 120` and `could not render diagram i/N (type): output budget exhausted (9,800 chars per reply)`. Only the reader sees them; the model never reads a `systemMessage`.
- No row cap per diagram: a tall diagram scrolls but stays intact. The budget alone bounds height.
- Width is the longest line measured in code points; emoji are already banned (ADR-0004), so there is no wide-glyph handling.
- The `SessionStart` script reads the same variable with the same default; a `node:test` case keeps the two defaults equal, as ticket #9 already requires for the type list.
- The context line sentence "Keep each diagram small: short labels, few nodes." becomes "Keep each diagram under N columns wide and about 60 rows tall: short labels, few nodes. Wider or longer diagrams are replaced by a notice.", with N the effective width limit.
