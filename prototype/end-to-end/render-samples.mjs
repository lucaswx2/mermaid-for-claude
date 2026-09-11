// PROTOTYPE - throwaway. Feeds every samples/*.mmd through bundle.mjs as if it were a Stop hook input.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const only = process.argv.slice(2);
for (const name of readdirSync('samples').filter((n) => n.endsWith('.mmd') && (only.length === 0 || only.includes(n)))) {
  const src = readFileSync(`samples/${name}`, 'utf8');
  const input = JSON.stringify({ last_assistant_message: 'Here:\n```mermaid\n' + src + '```\n' });
  const t0 = Date.now();
  const res = spawnSync('node', ['bundle.mjs'], { input, encoding: 'utf8' });
  const ms = Date.now() - t0;
  const out = JSON.parse(res.stdout || '{}');
  const lines = (out.systemMessage ?? '').split('\n');
  const width = Math.max(...lines.map((l) => l.length));
  console.log(`===== ${name}  exit=${res.status} processMs=${ms} chars=${(out.systemMessage ?? '').length} lines=${lines.length} width=${width} =====`);
  console.log(out.systemMessage ?? res.stderr);
  console.log();
}
