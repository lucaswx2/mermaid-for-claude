#!/usr/bin/env bash
# Stop hook wrapper (ADR-0003). Reads the hook input whole, exits silently when the plugin is disabled
# or the reply has no diagram block, prints one notice when node is missing, and otherwise hands the
# input to the committed bundle through a here-string so nothing in the reply is ever evaluated.
# Never exits non-zero, never blocks, never writes under the plugin root.
input=$(cat)

case "${MERMAID_FOR_CLAUDE_DISABLE:-}" in
  ''|0|false) ;;
  *) exit 0 ;;
esac

case "$input" in
  *'```mermaid'*) ;;
  *) exit 0 ;;
esac

if ! command -v node >/dev/null 2>&1; then
  printf '%s' '{"systemMessage":"mermaid-for-claude: node not found on PATH, diagram not rendered. Install Node 20+ or set MERMAID_FOR_CLAUDE_DISABLE=1 to silence this."}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
exec node "$root/dist/hook.mjs" <<< "$input"
