# Research: does `terminalSequence` work as a channel for a multi-line Stop-hook diagram?

Sources: https://code.claude.com/docs/en/hooks.md and https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md (fetched 2026-09-10). No usage found in https://github.com/anthropics/claude-code/tree/main/plugins or https://github.com/anthropics/claude-plugins-official (GitHub code search, `total_count: 0` for `terminalSequence` in both repos).

## Events that accept it

`Stop`'s "Supported output fields" list: `continueConversation` (decision), `systemMessage`, `terminalSequence`. Source: https://code.claude.com/docs/en/hooks.md, "Stop" section. So **yes, `Stop` accepts `terminalSequence`**.

`Notification` also lists it: "Supported output fields: `suppressNotification` (decision), `systemMessage` (note: `systemMessage` is logged but typically not displayed for notifications), `terminalSequence`." Source: same doc, "Notification" section.

The JSON output table (top-level, applies across events) defines the field itself:

> `terminalSequence` | An ANSI escape sequence or other terminal control string to emit. See [Emit terminal notifications](#emit-terminal-notifications) | string

Source: https://code.claude.com/docs/en/hooks.md, "JSON output" table.

## What it accepts

Quoted verbatim from the "Emit terminal notifications" section:

> Hook commands can emit terminal control sequences to trigger notifications, set window titles, or ring the bell. Return a `terminalSequence` field in your JSON output on any exit code. Claude Code writes the sequence directly to the terminal without interpretation or sanitization, so only use sequences you trust.

So the field is typed as an arbitrary `string`, and the doc says Claude Code writes it "directly to the terminal without interpretation or sanitization" — i.e. no documented length cap and no restriction to a notification-sequence allowlist (OSC 9, bell, etc. are given only as *examples*, not an enforced set). The doc's own example sequences:

```
Bell: \x07
Set window title (macOS/Linux): \x1b]0;<title>\x07
Set window title (Windows): \x1b]9;<title>\x07
```

This is unlike `systemMessage`, which the doc's common-fields intro frames as the display channel for a message ("return `systemMessage` in JSON output ... some events discard it or deliver it elsewhere") — `terminalSequence` is explicitly the parallel channel for "desktop notification, window title, or bell", not for arbitrary readable text. Nothing in the doc states a length cap for `terminalSequence` (the 2000-char cap belongs to `systemMessage`, referenced from prior project knowledge, not found written down in this fetch — mark that number UNVERIFIED against this source pass).

## Where it lands

> On macOS and Linux, command hooks run in their own session without a controlling terminal. The hook process and any child processes can't open `/dev/tty` or send escape sequences directly to the Claude Code interface. A `terminalSequence` in JSON output reaches the terminal through Claude Code's stdout.

Source: https://code.claude.com/docs/en/hooks.md, "Emit terminal notifications".

Key implications:
- The hook cannot write to the tty itself (no controlling terminal); `terminalSequence` is the *only* documented path from a hook to the terminal, proxied through Claude Code's own stdout.
- The doc does not say whether this bypasses the Ink/React-based TUI renderer entirely or is interleaved with it, and does not say whether the sequence is written before or after the assistant's reply is painted, or whether the TUI's next repaint overwrites/scrolls past it. **UNVERIFIED** — not addressed anywhere in the fetched doc.
- Because Claude Code proxies the raw bytes through its own stdout un-sanitized, a `terminalSequence` payload equal to plain multi-line text (not just OSC/bell control codes) would in principle also be written verbatim — the doc's wording ("terminal control sequences ... without interpretation or sanitization") does not technically forbid it, but every documented example and the field's framing ("desktop notification, window title, or bell") targets transient, single-shot terminal signaling, not scrollback content. Whether such a payload survives the TUI's next repaint (Stop hooks fire right before the turn completes, i.e. right before Claude Code redraws its own UI) is **UNVERIFIED**.

## Version and platform

Introduced in **Claude Code 2.1.141**:

> Added `terminalSequence` field to hook JSON output so hooks can emit desktop notifications, window titles, and bells without a controlling terminal

Source: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md, `## 2.1.141` heading.

Windows: the doc gives a Windows-specific example sequence (`Set window title (Windows): \x1b]9;<title>\x07`, OSC 9 instead of OSC 0), confirming Windows is a supported target for at least window-title control. But the "own session without a controlling terminal" paragraph is scoped explicitly to "macOS and Linux" — the doc is silent on whether Windows hook processes have the same controlling-terminal restriction or a different code path. **UNVERIFIED.**

## Examples in the wild

GitHub code search for `terminalSequence` returns 0 results in both `anthropics/claude-code` (plugins directory) and `anthropics/claude-plugins-official` as of 2026-09-10. The doc's own only example is the generic bell + window-title snippet shown above, used in a `PostToolUse` hook, not `Stop`:

```bash
#!/bin/bash
jq -n '{
  terminalSequence: "]0;Build Complete"
}'
```

No official plugin or first-party example uses `terminalSequence` for anything beyond bell/title, and none uses it to print visible multi-line body text.

## Verdict

**No — `terminalSequence` is not a viable channel for a 12-line diagram; treat it as unusable for this purpose without a spike, and even the spike is a long shot.** Every doc signal (field description, the three example sequences, its co-location with "trigger a desktop notification, set a window title, or ring the bell", and the total absence of real-world non-title/bell usage) points to it being scoped to short, transient terminal control signals, not a body-text display surface. It is technically a raw, unsanitized string written to Claude Code's stdout, so nothing in the doc *forbids* sending 12 lines of ASCII art through it, but the doc gives zero guarantees about paint order relative to the TUI repaint, persistence in scrollback, or whether the Ink renderer immediately overwrites it — all needed to know if a diagram would actually stay visible. `systemMessage` remains the only channel the doc actually documents as message display, but it is capped and delivered as a "system reminder" to Claude, not necessarily rendered as visible terminal text to the user for `Stop` either (per the doc's own caveat that "some events discard it or deliver it elsewhere"). Recommendation: don't build on `terminalSequence` for the diagram; if a visible-multi-line-output channel is truly needed, the plugin should render the diagram in the normal assistant message text instead of trying to shoehorn it through a hook output field, or a short throwaway spike (fire a `Stop` hook with a known multi-line `terminalSequence` payload and visually confirm what actually renders) is needed before betting the feature on this field.

## Open questions

- Does `terminalSequence` output survive Claude Code's next TUI repaint, or does Ink immediately overwrite/scroll past it? UNVERIFIED — undocumented.
- Is there an undocumented length cap or rate limit on `terminalSequence`? UNVERIFIED — doc says only "without interpretation or sanitization," no cap stated.
- Does Windows hit the same "no controlling terminal, proxied through stdout" path as macOS/Linux, or something else (e.g. ConPTY)? UNVERIFIED — doc's controlling-terminal paragraph is scoped to "macOS and Linux" only.
- Is the previously-assumed 2000-character cap on `systemMessage` documented anywhere in the current hooks.md? Not found in this fetch pass — UNVERIFIED against this source, should be re-checked directly against the `systemMessage` field description/table if that number matters for a different decision.
- Has anyone outside Anthropic (community plugins, forum posts) tried multi-line `terminalSequence` output and reported what happens? Not checked — out of scope for this pass (primary sources only, per task instructions).
