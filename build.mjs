import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/hook.ts'],
  outfile: 'dist/hook.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
});
