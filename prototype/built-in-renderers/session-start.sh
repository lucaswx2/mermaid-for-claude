#!/usr/bin/env bash
# PROTOTYPE - throwaway. Wayfinder ticket #15. The SessionStart context line from ticket #9 with the
# width limit from ADR-0005 and the seventeen recommended types from ADR-0006 and ADR-0007. No Node.
[ -n "$MERMAID_FOR_CLAUDE_DISABLE" ] && exit 0
command -v node >/dev/null 2>&1 || exit 0
input=$(cat)
session_id=$(printf '%s' "$input" | grep -oE '"session_id" *: *"[A-Za-z0-9_-]+"' | head -1 | sed -E 's/.*"([A-Za-z0-9_-]+)"$/\1/')
here="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}/prototype/built-in-renderers"
width="${MERMAID_FOR_CLAUDE_MAX_WIDTH:-}"
if ! [[ "$width" =~ ^[1-9][0-9]*$ ]]; then
  # Console width minus the 4-column indent of the `Stop says:` block. Windows: hook processes sit on an
  # invisible default console, so console-width.ps1 attaches to the claude.exe console (about 1.3 s, once per
  # session start) and also caches the value for the Stop hook. Elsewhere: `stty size` on the controlling tty.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) columns=$(powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$here/console-width.ps1" -SessionId "$session_id" -CacheDir "$here/cache" -CompileTo "$here/cache/console-width.exe" 2>/dev/null | tr -d '[:space:]') ;;
    *) columns=$(stty size </dev/tty 2>/dev/null | cut -d' ' -f2) ;;
  esac
  if [[ "$columns" =~ ^[1-9][0-9]*$ ]] && [ "$columns" -gt 4 ]; then width=$((columns - 4)); else width=120; fi
fi
types='flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, xychart-beta, pie, gitGraph, mindmap, journey, timeline, kanban, packet, radar, gantt, quadrantChart, block and treemap'
text="mermaid-for-claude is active: \`\`\`mermaid blocks in your replies are rendered as text diagrams right below the reply in this terminal. Prefer a mermaid block over hand-drawn ASCII for $types. Keep each diagram under $width columns wide and about 60 rows tall: short labels, few nodes. Wider or longer diagrams are replaced by a notice. erDiagram renders roughly; other mermaid types do not render here. This applies even where a skill says the terminal prints mermaid fences as raw text."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$text"
