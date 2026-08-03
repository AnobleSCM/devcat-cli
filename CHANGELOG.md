# Changelog

All notable changes to this project are documented in this file.

## [0.2.1]

Presentation-only delight pass on the local stack report. No change to what
is scanned, no new commands or flags, and `--json`/`--markdown` output is
byte-for-byte unchanged apart from the `cli_version` field.

- Terminal report: type labels (`mcp`/`plugin`/`skill`/`subagent`) get a
  cyan accent and per-type counts are bold, TTY-only and `NO_COLOR`-aware
- Empty state: warmer copy ("No AI tooling detected on this machine yet.")
  and `Looked in:` paths now print home-relative (`~/.claude/skills`)
- Fixed `NO_COLOR=''` (empty value) not being treated as "set" — the
  no-color.org standard disables color on presence, not truthiness
- Sync messaging: CLI description, error output, and README now say the
  hosted service is retired, not paused/rebuilt

## [0.2.0]

Standalone-first re-aim: local stack report for Claude Code, Codex, and Cursor, including skills and subagents.

- `--markdown` and `--json` output formats
- Truncation disclosure when a scan root hits its read ceiling
- Profile sync politely paused while devcat.dev is offline
- Skills and subagents are provably never sent off the machine

## [0.1.x]

Initial sync-focused release.
