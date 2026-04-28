# DevCat CLI

`npx devcat sync` — push your AI tool manifest to [devcat.dev](https://devcat.dev).

Manifest-only sync via RFC 8628 device authorization. Tokens stored in your OS keychain. Never sends env vars, configs, secrets, or file contents.

## Install

```bash
# Zero-install via npx (recommended)
npx devcat sync

# Or install globally
npm install -g devcat
devcat sync
```

Requires Node.js 20 or later. Works on macOS, Linux, and Windows.

## Commands

- `devcat sync` — push your tool manifest. Auto-triggers sign-in on first run.
- `devcat logout` — clear local credentials.
- `devcat --version` / `devcat --help`

## How it works

DevCat scans your local AI tool config (Claude Code, Codex CLI, Cursor) for tool **names and types only**. It never reads or transmits the rest — no env vars, no command args, no file contents, no paths.

Documentation lives at [devcat.dev](https://devcat.dev).

## License

MIT — see [LICENSE](./LICENSE).
