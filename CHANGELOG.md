# Changelog

All notable changes to this project are documented in this file.

## [0.2.4]

Fixes a false attribution introduced in 0.2.3: the Kimi Code scanner ran
unconditionally, so it could claim Kimi Code was installed when it never was.

- The Kimi Code scanner (MCP servers and skills, both scopes) now runs only
  when its own install marker exists on disk — `~/.kimi-code` at user scope,
  `.kimi-code` under the current directory at project scope — checked
  independently, so a project-only marker still scans that project with the
  user pass gated closed, and vice versa
- The bug: `~/.agents/skills` is not Kimi's own directory. It is the shared
  install target [skills.sh](https://github.com/vercel-labs/skills.sh) uses
  for several non-Kimi tools (Cline, Warp, Zed, Dexto, Loaf), so a user with
  one of those installed and no Kimi Code at all saw a phantom "Kimi Code"
  section. At user scope this was usually masked by scan-order dedupe
  (Claude Code's link farm wins); at project scope there was no dedupe to
  mask it, and devcat's own test suite already proved the misattribution
- Without the marker, Kimi Code now contributes nothing — no section in any
  report, no path in the empty-state "Looked in" list, no entry in `--json`
  `paths_checked`. The skill goes undetected rather than misattributed:
  undercount-honest, the same "no path is claimed unless it was actually
  checked" rule `paths_checked` already followed for every other client
- With the marker present, output is unchanged from 0.2.3

## [0.2.3]

Kimi Code joins Claude Code, Codex, and Cursor as a fourth scanned harness —
detection parity only, no product expansion.

- New scanner detects Kimi Code MCP servers and skills. MCP servers are read
  from `mcp.json` files (Kimi's actual config shape — JSON, not TOML, and
  never `config.toml`, which holds no MCP declarations): `~/.kimi-code/mcp.json`
  at user scope, and `<cwd>/.kimi-code/mcp.json` at project scope — read
  literally from the working directory, not found by an upward walk, matching
  Kimi's own documented behavior
- Skills are read from both roots Kimi auto-discovers: `.kimi-code/skills`
  and `.agents/skills`, at user and project scope. `~/.agents/skills` is the
  same shared shelf Claude Code and Codex already reach through their own
  link farms — the existing canonical-path dedupe now collapses a skill
  across all three harnesses, deterministically, under whichever client
  `detect()` scans first
- Terminal report, `--markdown`, `--json`, and the empty-state "Looked in"
  listing all gain a Kimi Code section using the existing type accents — no
  new colors
- Not scanned: Kimi's `.agents/agents` / `.kimi-code/agents` subagent roots.
  They are real and auto-discovered the same way the skill roots are, but
  subagent detection is outside this release's scope

## [0.2.2]

Presentation-only polish pass on the local stack report. Nothing about what is
scanned changed, there are no new commands or flags, and `--json`/`--markdown`
output is byte-for-byte unchanged apart from the `cli_version` field.

- Terminal report opens with the `devcat` wordmark and version, so a shared
  screenshot says what produced it and which release
- Each tool type gets its own accent — `mcp` cyan, `plugin` magenta, `skill`
  green, `subagent` blue — on both its label and its new count bar. Four hues
  of the standard ANSI 16 that read on light and dark terminals; red and
  yellow stay reserved for failure and truncation
- Per-type counts gain a proportional bar, scaled against the largest count
  anywhere in the report so equal lengths mean equal counts in every section
- Closing dim hint pointing at `npx devcat-cli --markdown`
- Empty state: locations under the current directory now print `./`-relative
  instead of as long absolute paths, and it carries the same wordmark header
- Color remains decoration only: ANSI-stripped output is byte-for-byte the
  plain render, for a populated, empty, and truncated scan alike

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
