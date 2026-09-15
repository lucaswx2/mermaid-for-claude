import * as esbuild from 'esbuild';

// Two bundles on purpose (ADR-0008): dist/hook.mjs is the entry hooks/stop.sh runs and never imports the
// renderer; dist/render-worker.mjs is what the worker thread evaluates and carries beautiful-mermaid.
// One bundle with a dynamic import would not do: esbuild inlines `import()` into a single outfile, so the
// main thread would still parse the renderer.
const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
};

await esbuild.build({ ...shared, entryPoints: ['src/hook.ts'], outfile: 'dist/hook.mjs' });
await esbuild.build({ ...shared, entryPoints: ['src/render-worker.ts'], outfile: 'dist/render-worker.mjs' });
