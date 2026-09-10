# Claude Code hooks contract: printing rendered text after each reply

Research for issue #2. Primary sources: [Hooks reference](https://code.claude.com/docs/en/hooks), [Plugins guide](https://code.claude.com/docs/en/plugins), [Plugins reference](https://code.claude.com/docs/en/plugins-reference), [claude-code CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), [hookify plugin source](https://github.com/anthropics/claude-code/tree/main/plugins/hookify).

## 1. `Stop` hook input JSON

Fields, per the Stop section of the hooks doc (https://code.claude.com/docs/en/hooks.md):

- `session_id` — current session identifier.
- `prompt_id` — UUID of the user prompt being processed.
- `transcript_path` — path to the conversation JSON/transcript file.
- `cwd` — current working directory.
- `scratchpad_dir` — session scratchpad path.
- `permission_mode` — one of `"default"`, `"plan"`, `"acceptEdits"`, `"auto"`, `"dontAsk"`, `"bypassPermissions"`.
- `effort` — object with `level`.
- `hook_event_name` — `"Stop"`.
- `last_assistant_message` — "Full text of Claude's response." The doc elsewhere describes it as "the final assistant text of the current turn," to be used "instead of reading the transcript file, which may lag the in-memory conversation." It is the raw text Claude produced, not further processed markdown-to-HTML — the doc gives no indication of any transformation.
  Source: https://code.claude.com/docs/en/hooks.md (Stop input table + field table).
- `stop_hook_active` — boolean, whether the stop hook is already active (loop-guard signal).
- `model`, `turn_index`, `tool_calls`, `stopped_by` — added in later releases (see §7); `stopped_by` is `"end_of_response"`, `"max_output_tokens"`, or `"max_iterations"`.
  Source: https://code.claude.com/docs/en/hooks.md.
- `background_tasks`, `session_crons` — added per CHANGELOG entry, version 2.1.145: "Stop and SubagentStop hook input now includes `background_tasks` and `session_crons` fields." Source: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md (line 2712, header `## 2.1.145`).

`last_assistant_message` was itself added in version 2.1.47: "Added `last_assistant_message` field to Stop and SubagentStop hook inputs, providing the final assistant response text so hooks can access it without parsing transcript files." Source: CHANGELOG.md, line 4793, header `## 2.1.47`.

## 2. `Stop` hook output JSON

Per the Stop decision-control table (https://code.claude.com/docs/en/hooks.md):

| Field | Supported for Stop | Effect |
|---|---|---|
| `permissionDecision` | yes | `"allow"` \| `"deny"` \| `"retry"`. `"deny"` blocks the response from being displayed; `"retry"` tells Claude to continue the conversation. Ignored on exit code 2. |
| `permissionDecisionReason` | yes | Shown to Claude when `permissionDecision` is `"deny"`/`"retry"`. **Character limit: 2000**, truncated without warning if longer. |
| `systemMessage` | yes | "Shown in the transcript. Character limit: 2000. Truncated without warning if longer." |
| `additionalContext` | yes | Added to Claude's next model call. |

General JSON-output field table (applies across events, quoted verbatim):

> `systemMessage` — string — "A message for Claude, shown in the transcript. Character limit: 2000. Truncated without warning if longer. Some events discard it; see the per-event section."

Key implications for "print rendered text after each reply":

- **`systemMessage` is documented as "a message for Claude,"** shown in the transcript — it is not framed as a user-facing display channel with its own styling. Multi-line text (newlines inside the JSON string) is preserved as-is; there's no documented markdown/ANSI rendering or color applied to it — it appears as plain text in the transcript.
- **Hard cap: 2000 characters, silently truncated** — no warning is shown when truncation happens. This caps how much "rendered text" can go through this channel per reply.
- It does **stay in the transcript/scrollback** (the doc's own words: "shown in the transcript"), as opposed to some other events where `systemMessage` is discarded — the doc explicitly says behavior "varies by event," but for Stop it is shown.
- `continue`, `decision`, `reason`, `suppressOutput` — these exact field names come from an older/alternate description of the JSON output schema seen in one fetch of the doc (not corroborated by the verbatim Stop table above, which instead documents `permissionDecision`/`permissionDecisionReason`/`systemMessage`/`additionalContext`/`hookSpecificOutput`/`terminalSequence`). **UNVERIFIED**: whether `continue`, `decision`, `reason`, `suppressOutput` are current, additional, or legacy/deprecated field names distinct from `permissionDecision` — the two schema descriptions did not fully reconcile across fetches of the same page. Treat the `permissionDecision`/`systemMessage`/`additionalContext`/`hookSpecificOutput` set as the verified current schema.

Sources: https://code.claude.com/docs/en/hooks.md (Stop decision control table, JSON Output field table).

## 3. Exit-code semantics for `Stop`

Quoted from https://code.claude.com/docs/en/hooks.md:

- **Exit code 0**: success. "For most events, Claude Code writes stdout to the debug log and doesn't show it in the transcript." Stop is not in the exceptions list (`UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `PostModelSwitch`) that treat plain stdout as context — so for Stop, plain-text stdout goes to the debug log only, not to the user or to Claude, unless it's valid JSON. Valid JSON on stdout (starts with `{`, ends with `}`) is parsed for the decision/output fields described in §2. Stderr on exit 0 "goes to the debug log only — Claude never sees it."
- **Exit code 2**: blocking error. "On events that can block, exit 2 blocks whether or not you print JSON — even a JSON `permissionDecision` of `"allow"` can't override it." For Stop specifically: "Exit 2 prevents Claude from stopping and continues the conversation." The blocking message shown is the reason from the JSON blocking decision if present, otherwise the stderr text. Claude Code still parses any valid JSON on stdout even under exit 2.
- **Other exit codes**: "doesn't block on its own for most hook events." With valid JSON present, it's honored as if exit 0 occurred. With invalid JSON, plain text, or empty stdout, it's a non-blocking error and the transcript shows a `<hook name> hook error` notice, followed by the first line of stderr prefixed `Failed with non-blocking status code:`.

Source: https://code.claude.com/docs/en/hooks.md ("Exit Code Behavior" section).

## 4. `timeout` per hook

- Default for `command`/`http`/`mcp_tool` hooks generally: **600 seconds**.
- `prompt` hooks: 30 seconds. `agent` hooks: 60 seconds.
- Reduced defaults apply only to `UserPromptSubmit`, `PreModelSwitch`, `PostModelSwitch` (30s) and `MessageDisplay` (10s, the lowest).
- `SessionEnd` hooks share a 1.5-second budget (extendable to at most 60s if configured longer).
- **`Stop` uses the general 600-second default** — it is not in the reduced-default list.
- The `timeout` field in a hook's own config (in seconds) overrides the default for that hook.

Source: https://code.claude.com/docs/en/hooks.md ("Timeout defaults" table).

## 5. `MessageDisplay` event

- **Fires**: while the assistant's message text is streamed and displayed to the user (concurrently with streaming, not only after the full reply is done).
- **Input JSON**: `session_id`, `hook_event_name` (`"MessageDisplay"`), `cwd`, `permission_mode`, plus `message_text` (the text being displayed) and `message_index`.
- **Cannot append or alter what the user sees**: "MessageDisplay is a display-only event that doesn't support decision control. Hooks cannot block or modify the message. The event is informational only — it fires while the text streams but produces no decisions that affect Claude Code's behavior."
- Added per CHANGELOG version **2.1.152**: "Added a `MessageDisplay` hook event that lets hooks transform or hide assistant message text as it is displayed." Note this changelog wording ("transform or hide") appears to describe intent/marketing language that is **narrower in the current reference doc**, which explicitly says hooks "cannot block or modify the message." **UNVERIFIED / discrepancy**: whether `MessageDisplay` ever supported transforming/hiding text and was later restricted, or whether the changelog line was imprecise from the start. Treat "display-only, cannot alter" (from the hooks reference) as current ground truth.

Sources: https://code.claude.com/docs/en/hooks.md ("MessageDisplay Event" section); CHANGELOG.md line 2602, header `## 2.1.152`.

## 6. Plugin `hooks/hooks.json` schema, `${CLAUDE_PLUGIN_ROOT}`, `SessionStart` + `additionalContext`

Schema (from https://code.claude.com/docs/en/plugins-reference and the real example below):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/format-code.sh" }
        ]
      }
    ]
  }
}
```

- Hook `type` values: `command`, `http`, `mcp_tool`, `prompt`, `agent`.
- `hooks/` lives at the plugin root (never inside `.claude-plugin/`); the file is `hooks/hooks.json`. Source: https://code.claude.com/docs/en/plugins.md ("Plugin structure overview" table: `hooks/` → "Event handlers in `hooks.json`").
- `${CLAUDE_PLUGIN_ROOT}` resolves to the absolute path of the plugin's installation directory, used for "scripts, binaries, and config files bundled with the plugin." It "changes when the plugin updates" and old versions should be treated as ephemeral (don't write state there). Source: https://code.claude.com/docs/en/plugins-reference.
- Real example verified from the official `hookify` plugin, `hooks/hooks.json` (https://raw.githubusercontent.com/anthropics/claude-code/main/plugins/hookify/hooks/hooks.json):

```json
{
  "description": "Hookify plugin - User-configurable hooks from .local.md files",
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/stop.py", "timeout": 10 } ] }
    ]
  }
}
```
(Full file also wires `PreToolUse`, `PostToolUse`, `UserPromptSubmit` the same way. Note this real-world example does **not** quote `${CLAUDE_PLUGIN_ROOT}` even though it's shell form — it works here because the path has no spaces; the reference doc's own recommendation is still to double-quote it.)

`SessionStart` + `additionalContext` (verbatim example from https://code.claude.com/docs/en/hooks.md, "SessionStart decision control"):

```bash
#!/bin/bash
input=$(cat)
project_dir=$(jq -r '.cwd' <<<"$input")

if [[ -f "$project_dir/.claude/project-context.json" ]]; then
  context=$(jq -r '.context' <"$project_dir/.claude/project-context.json")
  jq -n --arg ctx "$context" '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }'
fi
```

`SessionStart` decision-control table: `systemMessage` (shown in transcript, 2000-char cap, truncated silently) and `additionalContext` ("Added to Claude's first model call") are both supported. `SessionStart` fires "when Claude Code begins a session or resumes one," and at launch it "fires before [MCP] servers are available... Claude Code skips the event's `mcp_tool` hooks without calling their tools." Source: https://code.claude.com/docs/en/hooks.md ("SessionStart" section).

`hookSpecificOutput.additionalContext` for `Stop`/`SubagentStop` was added in CHANGELOG version **2.1.163**: "Hooks: Stop and SubagentStop hooks can now return `hookSpecificOutput.additionalContext` to give Claude feedback and keep the turn going without being labeled a hook error." Source: CHANGELOG.md line 2355, header `## 2.1.163`.

## 7. Hook command execution: Windows vs macOS/Linux

Per https://code.claude.com/docs/en/hooks.md ("Exec form and shell form"):

- **Exec form** (when the hook config has an `args` array): "Claude Code resolves `command` as an executable on `PATH` and spawns it directly with `args` as the argument vector. There is no shell, so each `args` element is one argument exactly as written." No quoting needed; behaves identically cross-platform.
- **Shell form** (when `args` is absent, i.e. `command` is a single string): "The `command` string is passed to a shell: `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed." The `shell` field can force a choice explicitly (e.g. `"shell": "powershell"` or `"shell": "bash"`).
- **Windows-specific gotcha with npm-style shims**: "On Windows, exec form requires `command` to resolve to a real executable such as a `.exe`. The `.cmd` and `.bat` shims that npm, npx, eslint, and other tools install in `node_modules/.bin` are not executables and can't be spawned without a shell." The documented workaround is to invoke `node` directly with the script path as an `args` element, e.g. `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js"]` — "works on every platform because `node.exe` is a real binary."
- **Path quoting**: shell-form commands need explicit quoting for paths with spaces (e.g. `"${CLAUDE_PLUGIN_ROOT}/scripts/server.sh"` quoted); exec form needs none since there's no shell involved.
- Additionally, plugin component paths (not hook `command` strings, but paths declared in the plugin manifest) that contain a backslash "load on Windows only" and are rejected elsewhere — the doc recommends forward slashes everywhere, e.g. `./commands/deploy.md`. Source: https://code.claude.com/docs/en/plugins-reference.

CHANGELOG history on Windows + hooks (all from https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md):

- `## 2.1.47`: "Fixed hooks (PreToolUse, PostToolUse) silently failing to execute on Windows by using Git Bash instead of cmd.exe (anthropics/claude-code#25981)." (line 4829) — this is the change that made Git Bash the default Windows shell for shell-form hooks.
- `## 2.1.161`: "Fixed Windows hooks that invoke bash explicitly (e.g., `/usr/bin/bash script.sh`) failing with 'command not found' or 'cannot execute binary file'." (line 2419)
- `## 2.1.111`: "Windows: `CLAUDE_ENV_FILE` and SessionStart hook environment files now apply (previously a no-op)." (line 3526)

**UNVERIFIED**: the doc doesn't spell out exactly how `node` is resolved on Windows (e.g. whether it must be on `PATH` as `node.exe` specifically, vs. `node.cmd`/version-manager shims like `nvm`/`volta` also being real executables or shims). Treat "node.exe is a real binary and works on every platform" as the extent of the documented guidance; version-manager-installed `node` shims were not covered by primary sources found.

## 8. CHANGELOG grep results (verbatim, with versions)

Grepped `raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md` for `systemMessage`, `MessageDisplay`, `last_assistant_message`, `Stop hook`/`hook.*Windows`:

- `## 1.0.64` — "Hooks: Added systemMessage field to hook JSON output for displaying warnings and context"
- `## 1.0.112` — "Hooks: Added systemMessage support for SessionEnd hooks"
- `## 2.1.152` — "Added a `MessageDisplay` hook event that lets hooks transform or hide assistant message text as it is displayed"
- `## 2.1.47` — "Added `last_assistant_message` field to Stop and SubagentStop hook inputs, providing the final assistant response text so hooks can access it without parsing transcript files."
- `## 2.1.47` — "Fixed hooks (PreToolUse, PostToolUse) silently failing to execute on Windows by using Git Bash instead of cmd.exe (anthropics/claude-code#25981)"
- `## 2.1.161` — "Fixed Windows hooks that invoke bash explicitly (e.g., `/usr/bin/bash script.sh`) failing with \"command not found\" or \"cannot execute binary file\""
- `## 2.1.163` — "Hooks: Stop and SubagentStop hooks can now return `hookSpecificOutput.additionalContext` to give Claude feedback and keep the turn going without being labeled a hook error"
- `## 2.1.111` — "Windows: `CLAUDE_ENV_FILE` and SessionStart hook environment files now apply (previously a no-op)"
- `## 2.1.259` — "Fixed blocking Stop hooks causing the turn after a block to lose the model's reasoning from that turn and, on some models, miss the prompt cache"
- `## 2.1.145` — "Stop and SubagentStop hook input now includes `background_tasks` and `session_crons` fields"
- `## 2.1.143` — "Fixed stop hooks that block repeatedly looping forever — the turn now ends with a warning after 8 consecutive blocks (override via `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`)"
- `## 1.0.45` — "Stop Hooks: Fixed transcript path after /clear and fixed triggering when loop ends with tool call"
- `## 1.0.41` — "Hooks: Split Stop hook triggering into Stop and SubagentStop"
- `## 2.0.30` — "Added prompt-based stop hooks"
- `## 2.0.41` — "Added `model` parameter to prompt-based stop hooks, allowing users to specify a custom model for hook evaluation"

Source: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md

## Minimal example: plugin `hooks/hooks.json` with `Stop` and `SessionStart`

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/on-stop.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/on-session-start.sh"
          }
        ]
      }
    ]
  }
}
```

## Minimal example: `Stop` hook stdout JSON producing a `systemMessage`

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "systemMessage": "Rendered diagram written to ./out/diagram.svg"
  }
}
```

(Exit code must be 0 for this to be read as the standard decision-model output rather than a blocking error; content must start with `{` and end with `}`; keep it under 2000 characters or it is silently truncated.)

## Open questions (UNVERIFIED)

1. Whether `continue`, `decision`, `reason`, `suppressOutput` are real, current top-level output fields distinct from `permissionDecision`/`hookSpecificOutput`, or stale/alternate terminology — the two fetches of the hooks doc did not agree, and no verbatim quote for these four fields specifically was obtained. Needs a direct, cached fetch of the "JSON Output" section's full field list (all rows, not just the ones surfaced by a summarizing fetch).
2. Whether `MessageDisplay` ever let a hook "transform or hide" text (per the 2.1.152 changelog wording) versus being purely observational as the current reference doc states — possible tightening of the feature between its introduction and now, unconfirmed.
3. Exact `node` resolution rules on Windows for exec-form hooks when `node` comes from a version manager (nvm-windows, volta, fnm) rather than a system install — not covered in the fetched primary sources.
4. Whether `systemMessage` in the transcript is visible to the *user* in the interactive terminal UI as of today, or only recorded in the transcript file/debug context that the user doesn't necessarily see live — the doc's phrase "shown in the transcript" was not cross-checked against the "Emit terminal notifications" / `terminalSequence` mechanism, which appears to be the actual channel for guaranteed live terminal output. A plugin wanting guaranteed visible output after each reply should look at `terminalSequence` (mentioned in the general JSON Output table) as a candidate alternative/supplement to `systemMessage`, but this needs its own follow-up.
