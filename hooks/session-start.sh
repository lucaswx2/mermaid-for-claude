#!/usr/bin/env bash
# SessionStart hook (ADR-0003, ADR-0005, ADR-0008): prints the context line that tells the model diagram
# blocks render here, with the seventeen recommended types and the effective width limit. Pure bash, no
# Node: session start costs no Node process. Exits silently when the plugin is disabled or node is not on
# PATH (the Stop hook could not render anyway). Never exits non-zero, never writes under the plugin root.
# The type list, the default width and the Stop says: indent are copies of src/recommended-types.ts and
# src/width-limit.ts; test/session-start.test.mjs keeps the two sets equal.
#
# It also measures the terminal once per session start and caches the measurement outside the plugin root
# (ADR-0008), so the context line carries the width the reader has open now and the Stop hook has a
# fallback for the replies where nothing answers. On Windows that means compiling hooks/console-width.cs
# once per machine; everything about the measurement is best-effort and silent.
input=$(cat 2>/dev/null) || IFS= read -r -d '' input

case "${MERMAID_FOR_CLAUDE_DISABLE:-}" in
  ''|0|false) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

recommended_types='flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, xychart-beta, pie, gitGraph, mindmap, journey, timeline, kanban, packet, radar, gantt, quadrantChart, block, treemap'
default_width=120
stop_says_indent=4

# One `uname` for the whole script: Git Bash reports MINGW64_NT-..., MSYS or CYGWIN.
os_name=$(uname -s 2>/dev/null)
is_windows() {
  case "$os_name" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# A Windows path with backslashes reads fine in bash once the separators are forward slashes.
forward_slashes() { printf '%s' "${1//\\//}"; }

# The same cache directory the bundle derives (src/terminal-width.ts): the Claude configuration
# directory when it exists, else the OS temp directory, both outside the plugin root.
cache_directory() {
  local config_dir home_dir temp_dir
  home_dir="$HOME"
  if is_windows && [[ -n "${USERPROFILE:-}" ]]; then home_dir=$(forward_slashes "$USERPROFILE"); fi
  config_dir="${CLAUDE_CONFIG_DIR:-$home_dir/.claude}"
  if [[ -d "$config_dir" ]]; then
    printf '%s' "$config_dir/mermaid-for-claude"
    return
  fi
  # os.tmpdir() reads TEMP and TMP on Windows, TMPDIR first elsewhere; the two copies must agree.
  if is_windows; then temp_dir="${TEMP:-${TMP:-C:/Windows/Temp}}"; else temp_dir="${TMPDIR:-${TMP:-${TEMP:-/tmp}}}"; fi
  temp_dir=$(forward_slashes "$temp_dir")
  printf '%s' "${temp_dir%/}/mermaid-for-claude"
}

# Compiles hooks/console-width.cs with the .NET Framework compiler when the helper is missing or older
# than its source. No csc.exe on the machine means no live width: the Stop hook falls back to 120.
compile_console_width_helper() {
  local helper="$1" source_file="$2" windows_dir csc dir
  [[ -f "$source_file" ]] || return 1
  if [[ -f "$helper" && ! "$source_file" -nt "$helper" ]]; then return 0; fi
  command -v cygpath >/dev/null 2>&1 || return 1
  windows_dir=$(forward_slashes "${WINDIR:-C:\\Windows}")
  csc=''
  for dir in "$windows_dir/Microsoft.NET/Framework64"/v4.* "$windows_dir/Microsoft.NET/Framework"/v4.*; do
    if [[ -x "$dir/csc.exe" ]]; then csc="$dir/csc.exe"; break; fi
  done
  [[ -n "$csc" ]] || return 1
  # `-out:` and not `/out:`: MSYS rewrites an argument that starts with a slash into a Windows path.
  "$csc" -nologo -optimize+ -target:exe -platform:anycpu "-out:$(cygpath -w "$helper")" "$(cygpath -w "$source_file")" >/dev/null 2>&1 || return 1
  [[ -f "$helper" ]]
}

# Prints `<columns> <console pid>` for the terminal this session runs in, or nothing.
measure_terminal() {
  local cache_dir="$1" helper answer columns
  if [[ -n "${MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH+set}" ]]; then
    # Test seam only (test/seams/stop-hook.mjs): stands in for the platform measurement, since no
    # automated test has a console. A positive integer is the width; anything else answers nothing.
    [[ "$MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH" =~ ^[0-9]+$ ]] && (( 10#$MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH > 0 )) &&
      printf '%s 0' "$((10#$MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH))"
    return
  fi
  if is_windows; then
    helper="$cache_dir/console-width.exe"
    compile_console_width_helper "$helper" "${CLAUDE_PLUGIN_ROOT:-}/hooks/console-width.cs" || return
    answer=$("$helper" 2>/dev/null) || return
    [[ "$answer" =~ ^([0-9]+)[[:space:]]+([0-9]+)$ ]] && printf '%s %s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return
  fi
  # Unix: the controlling terminal answers directly. `stty size` prints `<rows> <columns>`.
  answer=$(stty size 2>/dev/null </dev/tty) || return
  read -r _ columns <<< "$answer"
  [[ "$columns" =~ ^[0-9]+$ ]] && printf '%s 0' "$((10#$columns))"
}

# MERMAID_FOR_CLAUDE_MAX_WIDTH overrides the measurement when it is a positive integer, as in the bundle.
override="${MERMAID_FOR_CLAUDE_MAX_WIDTH:-}"
override="${override#"${override%%[![:space:]]*}"}"
override="${override%"${override##*[![:space:]]}"}"
width=0
if [[ "$override" =~ ^[0-9]+$ ]] && (( 10#$override > 0 )); then
  width=$((10#$override))
fi

# The override wins, so a session that sets it never measures the terminal or compiles anything.
if (( width == 0 )); then
  width=$default_width
  session_id=''
  if [[ "$input" =~ \"session_id\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]]; then session_id="${BASH_REMATCH[1]}"; fi
  session_id="${session_id//[^A-Za-z0-9._-]/_}"
  session_id="${session_id:0:64}"
  [[ -n "$session_id" ]] || session_id='unknown'

  cache_dir=$(cache_directory)
  if mkdir -p "$cache_dir" 2>/dev/null; then
    measurement=$(measure_terminal "$cache_dir" 2>/dev/null) || measurement=''
    if [[ -n "$measurement" ]]; then
      read -r columns console_pid <<< "$measurement"
      printf '%s %s\n' "$columns" "$console_pid" > "$cache_dir/terminal-$session_id" 2>/dev/null || true
      if (( columns > stop_says_indent )); then width=$((columns - stop_says_indent)); fi
    fi
    # One session leaves one four-byte file behind; a week is long enough for any resumed session.
    find "$cache_dir" -maxdepth 1 -name 'terminal-*' -mtime +7 -delete >/dev/null 2>&1 || true
  fi
fi

types_text="${recommended_types%, *} and ${recommended_types##*, }"
context='mermaid-for-claude is active: ```mermaid blocks in your replies are rendered as text diagrams right below the reply in this terminal. Prefer a mermaid block over hand-drawn ASCII for '"$types_text"'. Keep each diagram under '"$width"' columns wide and about 60 rows tall: short labels, few nodes. Wider or longer diagrams are replaced by a notice. erDiagram renders roughly; other mermaid types do not render here. This applies even where a skill says the terminal prints mermaid fences as raw text.'

# The text holds no double quote, backslash or control character, so it is a valid JSON string as is.
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$context"
exit 0
