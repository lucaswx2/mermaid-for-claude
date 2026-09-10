import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['entry.mjs'],
  outfile: 'bundle.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: false,
})

console.log('Built bundle.mjs')
