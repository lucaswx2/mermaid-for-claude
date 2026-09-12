#!/usr/bin/env bash
# PROTOTYPE - throwaway. Wayfinder ticket #15. The bash wrapper from ADR-0003 in front of the bundle:
# silent without a diagram block or with MERMAID_FOR_CLAUDE_DISABLE, one-line notice without node,
# otherwise the Stop hook input goes to the bundle verbatim through a here-string.
input=$(cat)
[ -n "$MERMAID_FOR_CLAUDE_DISABLE" ] && exit 0
case "$input" in
  *'```mermaid'*) ;;
  *) exit 0 ;;
esac
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
if ! command -v node >/dev/null 2>&1; then
  printf '%s' '{"systemMessage":"mermaid-for-claude: node is not on PATH (Node 20 or newer is required); diagram blocks were not rendered"}'
  exit 0
fi
exec node "$root/prototype/built-in-renderers/bundle.mjs" <<< "$input"
