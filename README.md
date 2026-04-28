# DevCat CLI

`npx @devcat/cli sync` — push your AI tool manifest to [devcat.dev](https://devcat.dev).

Manifest-only sync via RFC 8628 device authorization. Tokens stored in your OS keychain. Never sends env vars, configs, secrets, or file contents.

## Install

```bash
# Zero-install via npx (recommended)
npx @devcat/cli sync

# Or install globally
npm install -g @devcat/cli
devcat sync
```

Requires Node.js 20 or later. Works on macOS, Linux, and Windows.

## Quickstart

From any directory:

```bash
npx @devcat/cli sync
```

On the first run you'll see something like:

```
Sign in to DevCat

  Visit:       https://devcat.dev/device
  Enter code:  ABCD-EFGH

Code expires in 10 minutes.
```

The CLI opens your browser automatically. Sign in, paste the code, click Approve. The CLI continues automatically and prints a sync summary:

```
✓ Pushed 10 tools to devcat.dev

  7 matched           ready in My Tools
  2 matched (fuzzy)   review at https://devcat.dev/my-tools
  1 unmatched         linear-mcp-custom (no catalog match — still synced)

Sync complete.
```

## Commands

| Command | What it does |
|---|---|
| `devcat sync` | Push your tool manifest. Auto-triggers sign-in on first run. |
| `devcat logout` | Clear local DevCat credentials. |
| `devcat --version` | Print the CLI version. |
| `devcat --help` | Print top-level help. `devcat sync --help` shows sync-specific flags. |

### `devcat sync` flags

| Flag | Default | What it does |
|---|---|---|
| `--no-open` | off | Do not auto-open the browser at the verification URL. Useful for headless SSH or when you prefer manual paste. |
| `--json` | off | Emit a newline-delimited JSON event stream for CI inspection. |
| `--verbose`, `-v` | off | Emit a redacted HTTP trace to stderr. Authorization headers, tokens, and secrets are stripped. |

## How it works

DevCat scans your local AI tool config files for tool **names and types only**:

- **Claude Code**: `.mcp.json` (project), `~/.claude.json` (user MCP servers), `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`
- **Codex CLI**: `~/.codex/config.toml`, `.codex/config.toml` (project)
- **Cursor**: `~/.cursor/mcp.json`, `.cursor/mcp.json` (project)

The CLI extracts **only** the `(type, name)` tuples — it never reads or transmits:

- environment variable values
- command-line arguments
- file paths
- file contents
- any field other than the tool name and type

The full payload sent to `/api/sync` is a JSON object with two fields: `manifest_hash` (SHA-256 hex of the canonicalized tool list) and `tools` (array of `{ type, name }`). That's it.

Project-local manifests take precedence on dedup — if `context7` appears in both `.mcp.json` and `~/.claude.json`, the project-local copy wins.

## Authentication

DevCat uses [RFC 8628 OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628). Same flow as `gh auth login`, `vercel login`, `stripe login`.

Access tokens are valid for 1 hour and refresh tokens for 24 hours. After 24 hours of inactivity you'll be prompted to sign in again. Tokens are stored in your OS keychain via [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring) — never on disk in plaintext.

To see active CLI sessions or revoke a session, sign in to [devcat.dev](https://devcat.dev) and open the user menu (top-right) → "Active devices". Revoking a session takes effect on the next sync attempt.

## Troubleshooting

### `OS keychain unavailable` on Linux

On Linux servers without a graphical environment, the system keychain may not be running. Install `libsecret`:

```bash
# Debian / Ubuntu
sudo apt install libsecret-1-0

# Arch / Manjaro
sudo pacman -S libsecret

# Fedora / RHEL
sudo dnf install libsecret
```

For headless CI/CD pipelines, set the `DEVCAT_TOKEN` environment variable instead. The CLI reads this directly and skips the keychain.

### Headless SSH / WSL

If running over SSH without `$DISPLAY` or in WSL without a browser, the CLI detects this and skips browser auto-open. Copy the verification URL manually.

On WSL, if polling repeatedly fails with throttle responses, run `wsl --update` and try again — WSL's monotonic clock can drift relative to wall-clock time. The CLI mirrors gh CLI's safety multiplier, which handles most cases but not extreme drift.

### `Sync failed` errors

The error message includes the exact next step. Most common:

- `Rate-limited. Try \`npx @devcat/cli sync\` again in a moment.` — wait 60 seconds.
- `Approval timed out after 10 minutes.` — run `npx @devcat/cli sync` again to mint a new code.
- `Approval canceled.` — you clicked Cancel at /device. Run `npx @devcat/cli sync` again if you change your mind.
- `Session expired. Let's get you signed in again.` — refresh token is older than 24 hours. The CLI auto-runs the device flow inline; just type when prompted.

## Security

DevCat takes manifest-only sync seriously:

- **No env vars, no command args, no paths, no file contents leave your machine.** Source code, including a unit test, proves this for every release.
- **Tokens stored in OS keychain only.** No plaintext fallback. If the keychain is unavailable, the CLI errors clearly with install instructions.
- **Verification URL host is validated.** The CLI refuses to open URLs that don't match `devcat.dev` (or your `DEVCAT_API_URL` override) — defends against compromised servers redirecting users to phishing pages.
- **Bearer tokens redacted in `--verbose` output.** Authorization headers, `*_token`, `*_secret`, `device_code`, `user_code`, and `password` body fields all stripped from any HTTP trace.
- **Source is public** — read every line at [github.com/AnobleSCM/devcat-cli](https://github.com/AnobleSCM/devcat-cli).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DEVCAT_API_URL` | `https://devcat.dev` | Override the API base URL (staging / self-hosted). HTTPS required except `http://localhost:*`. |
| `DEVCAT_TOKEN` | unset | CI escape hatch — bypass keychain and use this access token directly. Token expires when CLI exits. |
| `DEVCAT_DEBUG` | unset | Enable verbose logging without `--verbose` flag. |
| `NO_COLOR` | unset | Disable color output ([no-color.org](https://no-color.org/) standard). |

## License

MIT — see [LICENSE](./LICENSE).
