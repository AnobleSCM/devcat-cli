# devcat-cli

<!-- BEGIN CUBIC-DISCIPLINE-BLOCK v2.5 -->
## Automated Review (Cubic + Gemini)

Every PR opened in this repo is automatically reviewed by two independent AI reviewers: **Cubic** (project-aware, MCP-callable) and **Gemini Code Assist** (GitHub-native). Both run on every PR — no manual trigger needed. The `agent-pr-gate@v2` workflow blocks auto-merge if either reviewer flags a P0 or P1, regardless of confidence.

**Branching policy:** Agents do not commit to main. Create a feature branch, push, open a draft PR, run `/cubic-self-check` (or the shell equivalent on non-Mac runtimes), mark ready when clean. The gate auto-merges. Andrew may commit directly to main when he explicitly says so ("commit directly" / "skip the PR").

**Before starting work in this repo:**
- Call `mcp__cubic__list_learnings` and read the project-specific patterns Cubic has accumulated. These are real issues found in past PRs.
- For architecture questions, query Cubic's auto-generated wiki via `mcp__cubic__list_wiki_pages` / `mcp__cubic__get_wiki_page` — it updates as code changes.

**After pushing a draft PR:**
1. Run `/cubic-self-check` (in Claude Code / Codex / Hermes) or the shell script directly (in opencode / Cowork / Bunk):
   ```bash
   cubic-self-check --pr <num> --repo AnobleSCM/<name> --runtime <your-runtime> --current-iter 1
   ```
2. Read the JSON signal on stdout:
   - `signal: clean` → mark PR ready (`gh pr ready <num>`). The gate auto-merges.
   - `signal: must-fix` → fix the listed P0/P1 findings, commit, push, then re-run with `--current-iter $((N+1))`.
   - `signal: escalate` → budget exhausted; an escalation file was written. Stop the loop. Do not mark PR ready.
3. The caller (YOU) tracks `--current-iter`. The script does NOT auto-increment.
4. Cap is 3 self-iterations (`--max-iter 3` default). After exhaustion, Plan 3's Paperclip cron handler triggers a Cubic background-agent fix or emails Andrew.

**Severity ladder (P0/P1 block; P2/P3 advisory):**

| Severity | Cubic signal | Gemini signal | Behavior |
|---|---|---|---|
| **P0** | `P0:` body prefix; OR severity≥8 in `security_privacy` / `bugs_logic` | `security-critical` or `security-high` badge | Hard block. Must fix. |
| **P1** | `P1:` body prefix; OR severity 5-7 | `high-priority` badge | Hard block. Must fix. |
| **P2** | severity≥8 in non-blocking category | `medium-priority` badge | Soft. Fix if trivial; reply with reasoning otherwise. |
| **P3** | severity 1-4 | `low-priority` or unrecognized | Log only. |

**Exit codes:** `0` for normal signal; `2` for system error (Cubic unreachable, gh failure, malformed response — a system-error JSON envelope is on stderr); `3` for auth error (Cubic key revoked or missing — run `~/Developer/scripts/cubic-rotate-key.sh` to rotate).

**Full design:** `~/workspace-wiki/wiki/architecture/cubic-gemini-pr-stack.md` (v2.5).
**Empirical API findings:** `~/Developer/scripts/CUBIC_API_NOTES.md`.
<!-- END CUBIC-DISCIPLINE-BLOCK v2.5 -->



