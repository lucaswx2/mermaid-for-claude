# Security

mermaid-for-claude runs two hooks inside Claude Code. What they do and do not do is part of the contract:

- The assistant reply is passed to the renderer as data and never evaluated as code or shell.
- No network access. Diagram source never leaves the machine.
- Nothing is written under the plugin folder. The only file written is a per-session terminal width cache under your Claude config directory (`~/.claude/mermaid-for-claude`), swept after a week.
- The hooks never exit non-zero and never block a reply.
- The renderer bundle in `dist/` is built from the TypeScript in `src/` by esbuild; CI on Ubuntu, Windows and macOS fails if `dist/` does not match the source.
- On Windows, the plugin compiles a small console probe (`hooks/console-width.cs`) once with the `csc.exe` that ships with the .NET Framework. The source is in the repo; no binary is ever committed.

## Reporting a vulnerability

If you find a way to break any of the points above, or anything else that could harm a user of the plugin, please report it privately through [GitHub's private vulnerability reporting](https://github.com/lucaswx2/mermaid-for-claude/security/advisories/new) rather than a public issue. You will get a reply within a week.

Supported version: the latest release only.
