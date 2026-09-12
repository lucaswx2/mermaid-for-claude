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
Anything in the plugin that turns a diagram block's source into ASCII/Unicode text: the baseline renderer or a built-in renderer.
_Avoid_: engine, backend, converter

**Baseline renderer**:
The third-party renderer bundled with the plugin. Draws the six graph-shaped types: flowchart, sequence, state, class, ER and xychart.
_Avoid_: library renderer, upstream renderer, main renderer

**Built-in renderer**:
A renderer written in this plugin for one diagram type. Draws with rows, bars and trees instead of geometry.
_Avoid_: custom renderer, fallback renderer, hand-rolled renderer

**Dispatcher**:
The part of the hook that reads a diagram block's header, strips front matter and directives, and picks the renderer or the notice.
_Avoid_: router, parser, front-end

**Trigger**:
The Claude Code event that starts rendering. v1: the `Stop` hook.
_Avoid_: listener, watcher, interceptor

**Supported type**:
A mermaid diagram type some renderer in the plugin can draw.

**Recommended type**:
A supported type the context line tells the model to prefer, because the maintainer judged its rendering good.
_Avoid_: preferred type, primary type, first-class type

**Unsupported type**:
A mermaid diagram type no renderer in the plugin can draw. Produces a notice instead of a diagram.

**Header**:
The one-line label printed above each diagram or notice, naming the plugin, the block's position in the reply and its type.
_Avoid_: title, caption, label

**Notice**:
The one-line message printed instead of a diagram: unsupported type, render failure, or missing runtime.
_Avoid_: warning, error, fallback message

**Context line**:
The sentence the plugin injects at `SessionStart` telling the model that diagram blocks render inline here.
_Avoid_: hint, system prompt, nudge

**Output budget**:
The most text one reply's rendering may add to the terminal, shared by every diagram and notice in that reply. A diagram that does not fit the remaining budget becomes a notice.
_Avoid_: size cap, char limit, quota

**Width limit**:
The widest rendered diagram the plugin will show. A wider diagram becomes a notice. Built-in renderers fit inside it; the baseline renderer is measured against it.
_Avoid_: max width, terminal width, column cap
