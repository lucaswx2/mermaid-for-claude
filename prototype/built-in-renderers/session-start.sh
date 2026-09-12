#!/usr/bin/env bash
# PROTOTYPE - throwaway. Wayfinder ticket #15. The SessionStart context line from ticket #9 with the
# width limit from ADR-0005 and the seventeen recommended types from ADR-0006 and ADR-0007. No Node.
[ -n "$MERMAID_FOR_CLAUDE_DISABLE" ] && exit 0
command -v node >/dev/null 2>&1 || exit 0
width="${MERMAID_FOR_CLAUDE_MAX_WIDTH:-}"
if ! [[ "$width" =~ ^[1-9][0-9]*$ ]]; then
  # Console width minus the 4-column indent of the `Stop says:` block: `mode con` on Windows (its second
  # number; lines come first, whatever the locale), `stty size` on the controlling tty elsewhere. 120 if unknown.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) columns=$(cmd //c mode con 2>/dev/null | grep -oE '[0-9]+' | sed -n 2p) ;;
    *) columns=$(stty size </dev/tty 2>/dev/null | cut -d' ' -f2) ;;
  esac
  if [[ "$columns" =~ ^[1-9][0-9]*$ ]] && [ "$columns" -gt 4 ]; then width=$((columns - 4)); else width=120; fi
fi
types='flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, xychart-beta, pie, gitGraph, mindmap, journey, timeline, kanban, packet, radar, gantt, quadrantChart, block and treemap'
text="mermaid-for-claude is active: \`\`\`mermaid blocks in your replies are rendered as text diagrams right below the reply in this terminal. Prefer a mermaid block over hand-drawn ASCII for $types. Keep each diagram under $width columns wide and about 60 rows tall: short labels, few nodes. Wider or longer diagrams are replaced by a notice. erDiagram renders roughly; other mermaid types do not render here. This applies even where a skill says the terminal prints mermaid fences as raw text."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$text"
