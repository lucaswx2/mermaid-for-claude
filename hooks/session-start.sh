#!/usr/bin/env bash
# SessionStart hook (ADR-0003, ADR-0005): prints the context line that tells the model diagram blocks
# render here, with the seventeen recommended types and the effective width limit. Pure bash, no Node:
# session start costs no Node process. Exits silently when the plugin is disabled or node is not on
# PATH (the Stop hook could not render anyway). Never exits non-zero, never writes under the plugin root.
# The type list and the default width are copies of src/recommended-types.ts and src/width-limit.ts;
# test/session-start.test.mjs keeps the two pairs equal.
input=$(cat 2>/dev/null) || IFS= read -r -d '' input

case "${MERMAID_FOR_CLAUDE_DISABLE:-}" in
  ''|0|false) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

recommended_types='flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, xychart-beta, pie, gitGraph, mindmap, journey, timeline, kanban, packet, radar, gantt, quadrantChart, block, treemap'
default_width=120

# MERMAID_FOR_CLAUDE_MAX_WIDTH overrides the default when it is a positive integer, as in the bundle.
override="${MERMAID_FOR_CLAUDE_MAX_WIDTH:-}"
override="${override#"${override%%[![:space:]]*}"}"
override="${override%"${override##*[![:space:]]}"}"
width=$default_width
if [[ "$override" =~ ^[0-9]+$ ]] && (( 10#$override > 0 )); then
  width=$((10#$override))
fi

types_text="${recommended_types%, *} and ${recommended_types##*, }"
context='mermaid-for-claude is active: ```mermaid blocks in your replies are rendered as text diagrams right below the reply in this terminal. Prefer a mermaid block over hand-drawn ASCII for '"$types_text"'. Keep each diagram under '"$width"' columns wide and about 60 rows tall: short labels, few nodes. Wider or longer diagrams are replaced by a notice. erDiagram renders roughly; other mermaid types do not render here. This applies even where a skill says the terminal prints mermaid fences as raw text.'

# The text holds no double quote, backslash or control character, so it is a valid JSON string as is.
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$context"
exit 0
