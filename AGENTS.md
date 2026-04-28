# AGENTS.md

## Project Contract

Use `/Users/andrewnoble/AGENTS.md` as the workspace-wide contract.

This repo is the standalone DevCat CLI package for `npx @anoblescm/devcat sync`. It is public, MIT-licensed, and publishes the `@anoblescm/devcat` npm package with the `devcat` binary. Be especially conservative around auth, token storage, package contents, and publish actions.

## Quick Commands

```bash
npm ci --no-audit --no-fund
npm run lint
npm run build
npm test
npm pack
```

## Guardrails

- Do not run `npm publish`, create git tags, or create GitHub releases unless Andrew explicitly asks.
- Do not commit generated `dist/` unless the current task explicitly requires package-output changes.
- Do not commit tarballs such as `devcat-*.tgz`.
- Keep the CLI manifest-only: no env vars, command args, file contents, or local paths should leave the machine.
- Preserve token safety: OS keychain by default, no plaintext token fallback, and redacted verbose output.

## Definition Of Done

- `npm run lint`, `npm run build`, and `npm test` pass.
- If package contents changed, verify with `npm pack` and inspect the tarball payload.
- If behavior changed, update the relevant README or handoff/report in `vibe-code-playbook`.
