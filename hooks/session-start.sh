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
# once per machine. Everything about the measurement is best-effort, silent and bounded by a deadline: a
# session start must never wait on it.
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

# A deadline for the commands that may carry one: the compiler, the probe's --self-test and `stty`, where
# `timeout` exists (it ships with Git Bash and every Unix), plain where it does not. The probe's measuring
# run is the one exception and bounds itself, for the reason given where it is run.
run_bounded() {
  local seconds="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$seconds" "$@"; else "$@"; fi
}

# The same cache directory the bundle derives (src/terminal-width.ts): CLAUDE_CONFIG_DIR, else the
# `.claude` directory of the home directory Node's os.homedir() would report. Outside the plugin root,
# and never the OS temp directory: a compiled binary does not belong somewhere world-writable.
cache_directory() {
  local home_dir
  home_dir="$HOME"
  if is_windows && [[ -n "${USERPROFILE:-}" ]]; then home_dir=$(forward_slashes "$USERPROFILE"); fi
  printf '%s' "${CLAUDE_CONFIG_DIR:-$home_dir/.claude}/mermaid-for-claude"
}

# Compiles hooks/console-width.cs with the .NET Framework compiler when the probe is missing or older
# than its source. No csc.exe on the machine means no live width: the Stop hook falls back to 120.
# The compiler writes to a temporary name that is moved into place whole, so a compile that is killed
# leaves nothing behind but that temporary, and two sessions compiling at once cannot read a half-written
# file. The move is what makes the timestamp the `-nt` test reads mean "a binary that finished".
compile_console_width_probe() {
  local probe="$1" source_file="$2" windows_dir csc dir building
  [[ -f "$source_file" ]] || return 1
  command -v cygpath >/dev/null 2>&1 || return 1
  windows_dir=$(forward_slashes "${WINDIR:-C:\\Windows}")
  csc=''
  for dir in "$windows_dir/Microsoft.NET/Framework64"/v4.* "$windows_dir/Microsoft.NET/Framework"/v4.*; do
    if [[ -x "$dir/csc.exe" ]]; then csc="$dir/csc.exe"; break; fi
  done
  [[ -n "$csc" ]] || return 1

  building="$probe.$$.tmp"
  # `-out:` and not `/out:`: MSYS rewrites an argument that starts with a slash into a Windows path.
  run_bounded 30 "$csc" -nologo -optimize+ -target:exe -platform:anycpu "-out:$(cygpath -w "$building")" "$(cygpath -w "$source_file")" >/dev/null 2>&1
  [[ -f "$building" ]] || { rm -f "$building"; return 1; }
  mv -f "$building" "$probe" 2>/dev/null || { rm -f "$building"; return 1; }
}

# A probe that answers `--self-test`, or nothing. Whatever sits at the path is asked to prove it runs
# before either hook trusts it, and deleted when it cannot: a binary truncated by a full disk, quarantined
# by a scanner or left by an interrupted older version would otherwise be trusted for as long as its
# timestamp stayed fresh, with no way back to a live width. Deleting it means the next session start
# compiles again. The self-test walks nothing, which is what makes it the one call safe to wrap in a
# deadline, and so the place where a binary that hangs is caught before it can hold up a session start.
ensure_console_width_probe() {
  local probe="$1" source_file="$2"
  if [[ ! -f "$probe" || "$source_file" -nt "$probe" ]]; then
    compile_console_width_probe "$probe" "$source_file" || return 1
  fi
  if [[ $(run_bounded 3 "$probe" --self-test 2>/dev/null) != 'ok' ]]; then
    rm -f "$probe"
    return 1
  fi
}

# Prints `<columns> <console pid> <console pid creation time>` for the terminal this session runs in, or
# nothing. The pid and its creation time are 0 off Windows, where nothing needs them.
measure_terminal() {
  local cache_dir="$1" probe answer columns
  if [[ -n "${MERMAID_FOR_CLAUDE_TEST_SEAM:-}" && -n "${MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH+set}" ]]; then
    # Test seam, gated by the marker the seam sets; src/terminal-width.ts carries the whole rule.
    [[ "$MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH" =~ ^[0-9]+$ ]] && (( 10#$MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH > 0 )) &&
      printf '%s 0 0' "$((10#$MERMAID_FOR_CLAUDE_FAKE_TERMINAL_WIDTH))"
    return
  fi
  if is_windows; then
    probe="$cache_dir/console-width.exe"
    ensure_console_width_probe "$probe" "${CLAUDE_PLUGIN_ROOT:-}/hooks/console-width.cs" || return
    # Run directly, with no `timeout` in front: the probe finds the terminal by walking the processes
    # above it, and a bounding process joins that chain. Measured, an MSYS `timeout` forks twice and the
    # walk stops there, so the width comes back empty. The probe carries its own deadline instead, and
    # the bounded --self-test above is what keeps a binary that cannot run from ever reaching this line.
    answer=$("$probe" 2>/dev/null) || return
    [[ "$answer" =~ ^([0-9]+)[[:space:]]+([0-9]+)[[:space:]]+([0-9]+)$ ]] &&
      printf '%s %s %s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return
  fi
  # Unix: the controlling terminal answers directly. `stty size` prints `<rows> <columns>`. The redirect
  # sits inside the bounded shell, so a terminal that blocks on open is bounded too, not just `stty`.
  answer=$(run_bounded 2 sh -c 'stty size </dev/tty' 2>/dev/null) || return
  read -r _ columns <<< "$answer"
  [[ "$columns" =~ ^[0-9]+$ ]] && printf '%s 0 0' "$((10#$columns))"
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
      read -r columns console_pid console_started <<< "$measurement"
      printf '%s %s %s\n' "$columns" "$console_pid" "$console_started" > "$cache_dir/terminal-$session_id" 2>/dev/null || true
      if (( columns > stop_says_indent )); then width=$((columns - stop_says_indent)); fi
    fi
    # One session leaves one small file behind; a week is long enough for any resumed session. A compile
    # killed between writing and moving leaves a temporary, which goes the same way.
    find "$cache_dir" -maxdepth 1 \( -name 'terminal-*' -o -name 'console-width.exe.*.tmp' \) -mtime +7 -delete >/dev/null 2>&1 || true
  fi
fi

types_text="${recommended_types%, *} and ${recommended_types##*, }"
context='mermaid-for-claude is active: ```mermaid blocks in your replies are rendered as text diagrams right below the reply in this terminal. Prefer a mermaid block over hand-drawn ASCII for '"$types_text"'. Keep each diagram under '"$width"' columns wide and about 60 rows tall: short labels, few nodes. Wider or longer diagrams are replaced by a notice. erDiagram renders roughly; other mermaid types do not render here. This applies even where a skill says the terminal prints mermaid fences as raw text.'

# The text holds no double quote, backslash or control character, so it is a valid JSON string as is.
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$context"
exit 0
