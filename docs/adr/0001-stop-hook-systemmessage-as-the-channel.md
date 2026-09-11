---
status: accepted
---

# `Stop` hook `systemMessage` is the channel

Rendered diagrams reach the terminal through the `systemMessage` field of the `Stop` hook's JSON output. The alternatives were rejected after a spike (wayfinder ticket #5, branch `prototype/channel-spike`, Claude Code 2.1.268 on Windows Terminal 1.24): `terminalSequence` is allowlisted to OSC 0/1/2/9/99/777 and BEL, so any body text makes the field silently ignored; `MessageDisplay` is display-only and cannot alter the streamed message; direct tty writes are impossible because hooks run without a controlling terminal. `systemMessage` renders as a dim, indented `Stop says:` block under the reply, preserves newlines and box-drawing alignment, stays in the transcript, and costs milliseconds.

## Consequences

- Hook output strings are capped at 10,000 characters. Longer output is written to a file under the session's `tool-results/` directory and replaced inline by the path plus a 2 KB preview. A diagram must stay under the cap or handle the overflow itself.
- The first line of the payload continues the `Stop says: ` line, so the payload must start with a newline or a short header line.
- The block is indented by four columns, so the usable width is the terminal width minus four.
- In `-p` mode and the Agent SDK, `systemMessage` arrives as an informational message, not as terminal text.
