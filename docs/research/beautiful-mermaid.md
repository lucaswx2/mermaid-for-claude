# Research: beautiful-mermaid ASCII rendering and bundling

Resolves issue #3. Package: `beautiful-mermaid@1.1.3`, MIT, https://github.com/lukilabs/beautiful-mermaid,
npm: https://www.npmjs.com/package/beautiful-mermaid. Runtime deps declared in its `package.json`:
`elkjs@^0.11.0`, `entities@^7.0.1` (source: `node_modules/beautiful-mermaid/package.json`).

Spike lives in `research/beautiful-mermaid-spike/` in this worktree: `npm init -y`, then
`npm i beautiful-mermaid@1.1.3 esbuild`, a `build.mjs` (esbuild), an `entry.mjs` (stdin → ASCII → stdout),
`samples/*.mmd`, and a `run-samples.sh` that feeds every sample through the built bundle.
Reproduce with `npm run build && npm run samples`.

## API

Entry point: `renderMermaidASCII(text: string, options?: AsciiRenderOptions): string`, exported from
`beautiful-mermaid`'s root (`dist/index.d.ts`, mirrored in `src/ascii/index.ts`). A deprecated alias
`renderMermaidAscii` points to the same function.

Signature is **synchronous** — no `await`, no Promise. The package's own JSDoc on the function says why:
"Synchronous — no async layout engine needed (unlike the SVG renderer)." (`src/ascii/index.ts`, JSDoc above
`renderMermaidASCII`). It throws (does not return an error value) on invalid/unsupported input — see below.

```ts
declare function renderMermaidASCII(text: string, options?: AsciiRenderOptions): string
```

`AsciiRenderOptions` (from `node_modules/beautiful-mermaid/dist/index.d.ts`):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `useAscii` | `boolean` | `false` | `true` = plain ASCII (`+`,`-`,`|`,`>`); `false` = Unicode box-drawing (`┌`,`─`,`│`,`►`) |
| `paddingX` | `number` | `5` | Horizontal spacing between nodes |
| `paddingY` | `number` | `5` | Vertical spacing between nodes |
| `boxBorderPadding` | `number` | `1` | Padding inside node boxes |
| `colorMode` | `'none' \| 'ansi16' \| 'ansi256' \| 'truecolor' \| 'html' \| 'auto'` | `'auto'` | Output coloring; `'auto'` detects terminal ANSI capability (or HTML mode in browsers) |
| `theme` | `Partial<AsciiTheme>` | built-in default | Per-element colors (`fg`, `border`, `line`, `arrow`, optional `accent`/`bg`/`corner`/`junction`) |

There is **no explicit direction option** for ASCII — flowchart direction (`TD`/`LR`/etc.) comes from the
diagram source itself (`graph TD`/`graph LR`/…), not from `AsciiRenderOptions`. There is no total-width /
max-width knob; layout is driven purely by `paddingX`/`paddingY`/`boxBorderPadding` plus the diagram's own
node/label sizes.

For the hook script we used `{ useAscii: true, colorMode: 'none' }` (see `entry.mjs`) to get portable plain
ASCII with no ANSI escape codes in output that might be captured/logged elsewhere.

## Supported types and failure modes

Confirmed by reading `src/ascii/index.ts`'s `detectDiagramType()` (this is the function
`renderMermaidASCII` uses to dispatch):

```ts
function detectDiagramType(text: string): 'flowchart' | 'sequence' | 'class' | 'er' | 'xychart' {
  const firstLine = text.trim().split('\n')[0]?.trim().toLowerCase() ?? ''
  if (/^xychart(-beta)?\b/.test(firstLine)) return 'xychart'
  if (/^sequencediagram\s*$/.test(firstLine)) return 'sequence'
  if (/^classdiagram\s*$/.test(firstLine)) return 'class'
  if (/^erdiagram\s*$/.test(firstLine)) return 'er'
  // Default: flowchart/state (handled by parseMermaid internally)
  return 'flowchart'
}
```

Six diagram types total (also stated in the README "Features" list: "6 diagram types — Flowcharts, State,
Sequence, Class, ER, and XY Charts"):

- **Flowchart** — header `graph TD|TB|LR|BT|RL` or `flowchart TD|TB|LR|BT|RL`
- **State diagram** — header `stateDiagram` or `stateDiagram-v2`, routed through the same `flowchart`
  branch in `detectDiagramType`, then disambiguated inside `parseMermaid` (`src/parser.ts`: `if
  (/^stateDiagram(-v2)?\s*$/i.test(header)) return parseStateDiagram(lines)`)
- **Sequence diagram** — header `sequenceDiagram`
- **Class diagram** — header `classDiagram`
- **ER diagram** — header `erDiagram`
- **XY chart** — header `xychart-beta` (or `xychart`)

Anything else — including `pie`, which mermaid.js supports but beautiful-mermaid does not — falls through
`detectDiagramType`'s default branch into the flowchart/state parser, `parseMermaid()` (`src/parser.ts`),
which throws a plain `Error`:

```
throw new Error(`Invalid mermaid header: "${lines[0]}". Expected "graph TD", "flowchart LR", "stateDiagram-v2", etc.`)
```

Verified by running `samples/pie-unsupported.mmd` (header `pie title Pets`) through the bundle: it exits
with code 1 and prints (via our `entry.mjs`, which reports `err.constructor.name`):

```
[Error] Invalid mermaid header: "pie title Pets". Expected "graph TD", "flowchart LR", "stateDiagram-v2", etc.
```

So: unsupported diagram type → plain JS `Error` (not a custom error class — `src/parser.ts` and
`src/ascii/validate.ts` both do `throw new Error(...)`, there is no `MermaidParseError` or similar
exported from the package's `dist/index.d.ts`), synchronous throw, catchable with a normal `try/catch`
around `renderMermaidASCII()`.

**Caveat found during testing — not every malformed input throws.** `samples/syntax-error.mmd` contains
deliberately broken flowchart syntax (`A[Start -->> B((broken`, unterminated bracket, malformed edge). It
did **not** throw. It silently degraded to a diagram with a single empty-labeled node `A` and exit code 0:

```
+---+
|   |
| A |
|   |
+---+
```

This is because the parser is a "line-by-line regex approach" (`src/parser.ts` header comment) rather than
a strict grammar — lines/tokens it can't match are dropped rather than rejected. **Implication for the hook
script**: `try/catch` alone is not sufficient to detect all malformed Mermaid; some bad input will render a
near-empty or wrong diagram instead of failing loudly. UNVERIFIED: the exact boundary of what the regex
parser accepts vs. silently drops vs. throws on — would need broader fuzzing of the parser to characterize
fully.

## Bundling (size, cold start, caveats)

Built with esbuild (`bundle: true, platform: 'node', format: 'esm', target: 'node20'`) from a tiny
`entry.mjs` that imports only `{ renderMermaidASCII }` from `beautiful-mermaid` and pipes stdin → ASCII →
stdout. Full `build.mjs` is in the spike directory.

- **Bundle size (unminified)**: 3,515,999 bytes (~3.4 MB), 97,684 lines — measured with `wc -c bundle.mjs`
  and `wc -l bundle.mjs` after `node build.mjs`.
- **Bundle size (minified, `minify: true`)**: 1,550,765 bytes (~1.51 MB) — measured with a throwaway
  esbuild config identical to `build.mjs` plus `minify: true`.
- **No unresolved external imports**: `grep -oE "^import[^;]*from ['\"][^'\"./][^'\"]*['\"]" bundle.mjs`
  and a search for `from "node:*"` both returned nothing — the bundle references no bare-specifier imports
  at all (not even Node built-ins under a `node:` prefix), confirming it is a single, dependency-free file
  once built. `node bundle.mjs` runs with zero `node_modules` present.
- **Cold start** (`time`-style measurement, `node bundle.mjs < samples/flowchart.mmd`, wall time via
  `date +%s%N` deltas, 3 runs): **307 ms, 285 ms, 271 ms** (~270–310 ms per run, includes Node process
  startup + module evaluation of the whole 3.4 MB bundle + one small-flowchart render). This is a cold
  process each time (no warm reuse), representative of a hook invoked as a fresh `node` subprocess per
  call.
- **elkjs does not need a worker or WASM in Node for this code path.** `elk-instance.ts` imports
  `elkjs/lib/elk.bundled.js` — described in its own comment as "pure synchronous JS, ~1.6 MB" — and
  patches `globalThis.setTimeout` plus deletes a temporary `self` global during construction to force
  ELK's bundled worker shim (`FakeWorker`) to run synchronously in-process, then calls
  `dispatcher.saveDispatch()` directly and intercepts `onmessage` synchronously, bypassing both of
  `elk.bundled.js`'s internal `setTimeout(0)` hops (`src/elk-instance.ts`, full file read). No
  `worker_threads`, no `Worker` from `node:worker_threads`, no WASM binary anywhere in
  `node_modules/beautiful-mermaid/src` — `grep -rn "Worker\|worker_threads\|wasm\|WebAssembly"` over that
  file found only the FakeWorker/ELK JS-worker-shim references described above, nothing indicating real
  OS threads or WASM.
- **But this elkjs/ELK code path is not used by the ASCII renderer at all** — see "SVG path" below. So for
  an ASCII-only hook script, the ~1.6 MB `elk.bundled.js` still ends up in the bundle (esbuild can't tell
  it's dead code, because `elkLayoutSync` is reachable from the same module graph as
  `renderMermaidASCII` via `beautiful-mermaid`'s single `dist/index.js` entry point) even though it is
  never called at runtime for ASCII-only usage. This is the main driver of bundle size — UNVERIFIED
  precisely how much of the 1.5 MB minified bundle is `elk.bundled.js` alone vs. ASCII/parser code, but
  given ELK is "~1.6 MB" on its own per the package's own comment, it is plausibly most of it, even though
  it never executes on the ASCII path. A follow-up could try tree-shaking/import-only-what's-needed if
  bundle size becomes a real constraint (would require a subpath import beautiful-mermaid does not
  currently expose — its `exports` map only exposes the single root entry, `dist/index.js`
  (`node_modules/beautiful-mermaid/package.json`)).

## SVG path

The SVG renderer (`renderMermaidSVG` / `renderMermaidSVGAsync`, `src/index.ts` + `src/layout-engine.ts`)
and the ASCII renderer (`renderMermaidASCII`, `src/ascii/index.ts` + `src/ascii/*.ts`) **do not share a
layout engine**:

- `src/layout-engine.ts` imports and calls `elkLayoutSync` from `./elk-instance.ts` (`import {
  elkLayoutSync } from './elk-instance.ts'`, called at `layout-engine.ts:1408`) — this is the ELK.js-based
  layout used for SVG output (flowchart/state diagrams; class/ER/sequence/xychart SVG paths have their own
  layout modules under `src/class`, `src/er`, `src/sequence`, `src/xychart` per the top-level `src/` listing).
- `grep -rn "elk" node_modules/beautiful-mermaid/src/ascii/` returns **no matches** — the entire `src/ascii/`
  tree (which is what `renderMermaidASCII` uses) never references ELK. Its own JSDoc says why: "Synchronous
  — no async layout engine needed (unlike the SVG renderer)."
- Instead, ASCII layout is a self-contained grid/pathfinding system: `src/ascii/grid.ts` (node placement on
  a text grid) and `src/ascii/pathfinder.ts` (edge routing between grid cells), described in the README as
  ported from Alexander Grooff's Go project [mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii)
  and extended by the beautiful-mermaid authors.

**Implication for a later SVG export feature**: it cannot reuse the ASCII code path's layout, and pulling
in SVG export means pulling in the ~1.6 MB `elk.bundled.js` dependency for real (not just as unused bundle
weight, but actually executed) — that's an accepted cost already present in this bundle's size numbers
above, since `elk.bundled.js` ships in the bundle either way due to the single-entry-point `exports` map.

## Sample outputs (verbatim)

All produced by `node bundle.mjs < samples/<name>.mmd` against the esbuild bundle described above, using
`entry.mjs`'s options `{ useAscii: true, colorMode: 'none' }`.

### flowchart.mmd (supported)

Source:
```
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[End]
```

Output (exit 0):
```text
+----------+            
|          |            
|  Start   |            
|          |            
+----------+            
      |                 
      |                 
      |                 
      |                 
      v                 
<---------->            
|          |            
| Decision |--------+   
|          |        |   
<---------->       No   
      |             |   
     Yes            |   
      |             |   
      |             |   
      v             v   
+----------+     +-----+
|          |     |     |
|  Action  |     | End |
|          |     |     |
+----------+     +-----+
```

### sequence.mmd (supported)

Source:
```
sequenceDiagram
    Alice->>Bob: Hello Bob, how are you?
    Bob-->>Alice: I am good thanks!
```

Output (exit 0):
```text
 +-------+                     +-----+   
 | Alice |                     | Bob |   
 +-------+                     +-----+   
     |                            |      
     |  Hello Bob, how are you?   |      
     |---------------------------->      
     |                            |      
     |     I am good thanks!      |      
     <............................|      
     |                            |      
 +-------+                     +-----+   
 | Alice |                     | Bob |   
 +-------+                     +-----+   
```

### state.mmd (supported)

Source:
```
stateDiagram-v2
    [*] --> Idle
    Idle --> Running: start
    Running --> Idle: stop
    Running --> [*]
```

Output (exit 0):
```text
*---------*
|         |
*---------*
     |     
     |     
     |     
     |     
     v     
.---------.
|         |
|   Idle  |
|         |
'---------'
     ^     
   start   
     |     
   stop    
     v     
.---------.
|         |
| Running |
|         |
'---------'
     |     
     |     
     |     
     |     
     v     
#=========#
‖         ‖
#=========#
```

### class.mmd (supported)

Source:
```
classDiagram
    class Animal {
        +String name
        +makeSound()
    }
    class Dog {
        +bark()
    }
    Animal <|-- Dog
```

Output (exit 0):
```text
+---------------+    
| Animal        |    
+---------------+    
| +name: String |    
+---------------+    
| +makeSound    |    
+---------------+    
        ^            
    -----            
    |                
+-------+            
| Dog   |            
+-------+            
|       |            
+-------+            
| +bark |            
+-------+            
                     
                     
```

### er.mmd (supported)

Source:
```
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
```

Output (exit 0):
```text
+----------+      +-------+      
| CUSTOMER ||---o<| ORDER |      
+----------+places+-------+      
                      |          
      ----------------- contains 
      |               |          
      <               |          
+-----------+                    
| LINE_ITEM |                    
+-----------+                    
                                 
                                 
```

### xychart.mmd (supported)

Source:
```
xychart-beta
    title "Sales"
    x-axis [jan, feb, mar]
    y-axis "Revenue" 0 --> 100
    bar [10, 50, 90]
```

Output (exit 0):
```text
                               Sales

 100+............................................................
    |
    |                                              ########
    |                                              ########
  80+..............................................########......
    |                                              ########
    |                                              ########
    |                                              ########
  60+..............................................########......
    |                          ########            ########
    |                          ########            ########
  40+..........................########............########......
    |                          ########            ########
    |                          ########            ########
    |                          ########            ########
  20+..........................########............########......
    |                          ########            ########
    |      ########            ########            ########
    |      ########            ########            ########
   0+......########............########............########......
    +----------+-------------------+-------------------+---------
              jan                 feb                 mar
```

### pie-unsupported.mmd (unsupported diagram type)

Source:
```
pie title Pets
    "Dogs" : 40
    "Cats" : 60
```

stdout: empty. stderr (exit 1):
```text
[Error] Invalid mermaid header: "pie title Pets". Expected "graph TD", "flowchart LR", "stateDiagram-v2", etc.
```

### syntax-error.mmd (malformed flowchart syntax)

Source:
```
graph TD
    A[Start -->> B((broken
```

Output (exit 0 — does **not** throw; see "Supported types and failure modes" caveat above):
```text
+---+
|   |
| A |
|   |
+---+
```

## Open questions

- UNVERIFIED: exact fraction of bundle size attributable to `elk.bundled.js` vs. ASCII/parser code — would
  need a source-map/bundle-analyzer pass (e.g. `esbuild --metafile` + `esbuild-visualizer`) to quantify;
  not done here since the task only required size/cold-start numbers, not a breakdown.
- UNVERIFIED: whether a subpath/tree-shaken import that excludes `elk.bundled.js` entirely is possible
  without a code change or fork — the package's `exports` map currently exposes only the single root
  entry point (`node_modules/beautiful-mermaid/package.json`: `"exports": { ".": { "import":
  "./dist/index.js", ... } }`), so no.
- UNVERIFIED: the full boundary of the flowchart/state regex parser's "silently drop unrecognized tokens"
  behavior — only one hand-crafted malformed sample was tested; a broader set of malformed inputs
  (unterminated subgraphs, bad `classDiagram`/`erDiagram`/`sequenceDiagram` syntax, etc.) was not
  exhaustively fuzzed. It's plausible other diagram types' parsers (`src/ascii/class-diagram.ts`,
  `src/ascii/er-diagram.ts`, `src/ascii/sequence.ts`, `src/ascii/xychart.ts` and its `../xychart/parser.ts`
  import) throw more consistently than the flowchart/state regex parser — not verified here.
- UNVERIFIED: memory/CPU behavior under many repeated invocations in the same process (only fresh
  cold-start `node bundle.mjs` subprocess runs were measured, matching the hook-script use case of one
  process per call).
