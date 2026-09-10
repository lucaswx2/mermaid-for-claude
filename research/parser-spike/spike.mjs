import { parse } from '@mermaid-js/parser';

const pie = `pie title Pets
    "Dogs" : 40
    "Cats" : 30
    "Birds" : 30`;

const gitGraph = `gitGraph
    commit
    branch develop
    checkout develop
    commit
    checkout main
    merge develop`;

const run = async (type, text) => {
  try {
    const ast = await parse(type, text);
    console.log(`\n--- ${type} OK ---`);
    const seen = new WeakSet();
    console.log(JSON.stringify(ast, (k, v) => {
      if (k === '$container' || k === '$document' || k === '$cstNode') return undefined;
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    }, 2).slice(0, 2000));
  } catch (e) {
    console.log(`\n--- ${type} FAILED ---`);
    console.log(e.message);
  }
};

await run('pie', pie);
await run('gitGraph', gitGraph);
