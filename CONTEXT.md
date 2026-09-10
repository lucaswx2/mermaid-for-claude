# mermaid-for-claude

Renders mermaid diagrams that Claude Code writes into a reply so the person reading the terminal actually sees a diagram instead of raw fence text.

## Language

**Diagram block**:
A fenced ```mermaid code block inside an assistant reply.
_Avoid_: mermaid snippet, chart, graph

**Surface**:
The place where a rendered diagram appears. v1 has one surface: the terminal the reply is shown in.
_Avoid_: target, output, destination

**Channel**:
The path a rendered diagram takes from the hook to the surface, e.g. the Stop hook's `systemMessage` or a direct tty write.
_Avoid_: transport, pipe, output stream

**Renderer**:
The engine that turns a diagram block's source into ASCII/Unicode text.
_Avoid_: engine, backend, converter

**Trigger**:
The Claude Code event that starts rendering. v1: the `Stop` hook.
_Avoid_: listener, watcher, interceptor

**Supported type**:
A mermaid diagram type the renderer can draw.

**Unsupported type**:
A mermaid diagram type no renderer in the plugin can draw. Produces a notice instead of a diagram.

**Notice**:
The one-line message printed in place of a diagram that could not be rendered.
_Avoid_: warning, error, fallback message

**Context line**:
The sentence the plugin injects at `SessionStart` telling the model that diagram blocks render inline here.
_Avoid_: hint, system prompt, nudge
