import { renderMermaidASCII } from 'beautiful-mermaid'

// Reads mermaid diagram source from stdin, prints the ASCII rendering to stdout.
// On parse/render failure, prints the error name and message to stderr and exits 1.

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

const source = await readStdin()

try {
  const ascii = renderMermaidASCII(source, { useAscii: true, colorMode: 'none' })
  process.stdout.write(ascii + '\n')
} catch (err) {
  process.stderr.write(`[${err?.constructor?.name ?? 'Error'}] ${err?.message ?? String(err)}\n`)
  process.exit(1)
}
