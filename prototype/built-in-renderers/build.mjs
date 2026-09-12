import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['hook.mjs'],
  outfile: 'bundle.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
})

console.log('Built bundle.mjs')
