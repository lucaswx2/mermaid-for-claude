---
status: accepted
---

# A bash wrapper gates the Node bundle

The `Stop` hook command is `bash "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"`, not `node` directly. The wrapper reads stdin with `$(cat)`, exits silently when `MERMAID_FOR_CLAUDE_DISABLE` is set or the reply has no diagram block, prints a one-line notice when `node` is not on `PATH`, and otherwise hands the input to the committed bundle with `exec node "$CLAUDE_PLUGIN_ROOT/dist/hook.mjs" <<< "$input"`. Chosen in wayfinder ticket #8 over calling `node` directly, with or without a lazy import of the renderer, because it is the only form that keeps the charting preference "no Node means one notice, and only when a diagram block is present": without a shell in front, Claude Code prints its own `Stop hook error` line on every reply. Measured on the maintainer's Windows machine (Git Bash, SATA SSD): a reply without a diagram costs about 200 ms with the wrapper against 270 to 340 ms for a direct bundle load; a reply with a diagram pays about 130 ms more than direct `node`. On Linux and macOS `bash` starts in a few milliseconds, so replies without a diagram cost almost nothing.

## Consequences

- `bash` is required, as it already is for Claude Code on Windows through Git Bash and for the official `datadog` and `security-guidance` plugins. POSIX `sh` is not enough: `dash` lacks `read -d`. `$(cat)` is used instead of `read -d ''` because the latter grows linearly with input size (about 480 ms at 100 KB).
- The wrapper never exits non-zero and never blocks; every failure it can see becomes a `systemMessage` notice, so Claude Code's `Stop hook error` line never appears because of this plugin.
- Passing the input through a here-string preserves backslashes, quotes, `$(...)`, backticks and `$VAR` verbatim; nothing in the reply is ever evaluated by the shell (verified with a hostile payload).
- A Windows install path with a drive letter and backslashes works when interpolated into the `bash` command and read from `$CLAUDE_PLUGIN_ROOT` inside the script (verified on Git Bash).
- The `SessionStart` hook follows the same pattern with its own bash script and no Node at all.
