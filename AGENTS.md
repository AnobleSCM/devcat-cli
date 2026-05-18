# AGENTS.md

<!-- BEGIN CUBIC-DISCIPLINE-BLOCK v2.7 -->
## Automated PR Review (Cubic required, Gemini advisory) — REQUIRED workflow

**THIS IS NOT OPTIONAL.** Every code change in this repo goes through the PR-based gate. Andrew is a non-developer and cannot review PRs himself. Cubic is the required AI reviewer; Gemini is advisory when available. The PR-and-gate workflow exists so bad code never lands on main without an AI catch.

### The rule (no exceptions unless Andrew explicitly overrides)

**NEVER push commits directly to `main`.** Always work on a feature branch, open a draft PR to register the work, run `/cubic-self-check`, submit the PR by marking it ready only after a clean signal, and let the gate auto-merge. Direct commits to main are forbidden unless Andrew says verbatim "commit directly" or "skip the PR" — and even then, only for that single task.

Draft PR creation is registration, not review submission. "Submit the PR" means `gh pr ready`; Cubic self-check is mandatory before that ready/submitted state. The PreToolUse hook at `~/.claude/hooks/cubic-self-check-gate.sh` enforces this for Claude Code; Codex / Hermes / Bunk runtimes self-enforce by following this rule.

### Branch hygiene (do this every time)

**Before starting any task:**
```bash
git checkout main
git pull
git checkout -b <descriptive-branch-name>
```
Your branch must be fresh-from-`origin/main`. Stale branches cause merge conflicts that you'll have to rebase later.

**If you get a "PR is stale" or "needs rebase" warning** (because another PR merged while you were working):
```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```
The gate will re-run automatically after the force-push.

**After your PR merges:**
```bash
git checkout main
git pull
git branch -D <your-merged-branch>     # clean up local
# If you used a worktree: rm -rf <worktree-path>; git worktree prune
```

### The full PR loop (after you have changes to commit)

1. Commit your changes locally on your feature branch.
2. Push: `git push -u origin <branch-name>`
3. Open a **draft** PR to register the work: `gh pr create --draft --title "..." --body "..."`
4. Run `/cubic-self-check` (in Claude Code / Codex / Hermes) or the shell script directly:
   ```bash
   cubic-self-check --pr <num> --repo AnobleSCM/<name> --runtime <your-runtime> --current-iter 1
   ```
   It returns a JSON signal on stdout. Cap is 3 self-iterations.
5. Read the JSON signal:
   - **`signal: clean`** → submit the PR by marking it ready (`gh pr ready <num>`). The hook only allows this if the clean state was recorded by step 4.
   - **`signal: must-fix`** → read the `findings` array, apply fixes to the code, commit, push, re-run step 4 with `--current-iter $((N+1))`.
   - **`signal: escalate`** → budget exhausted; an escalation file was written. Do NOT mark PR ready. The PR sits open until handled.
6. After marking the PR ready, the gate runs server-side (~2 min). **YOU MUST WATCH THE GATE.** Don't end your session until the PR has reached a terminal state:
   ```bash
   cubic-self-check --pr <num> --repo AnobleSCM/<name> --runtime <your-runtime> --current-iter <N+1> --watch
   ```
   `--watch` polls the gate checks via `gh pr checks`. It exits clean once the gate passes and the PR merges, or returns must-fix if the gate failed (with the failure details). You then loop back to step 5.

### What "do NOT push to main" means in practice

- `git push origin main` — forbidden.
- `git push` while on `main` branch — forbidden.
- Direct merge to main via `gh pr merge --merge` (non-squash, non-auto) — forbidden unless Andrew explicitly overrides.

### CRITICAL: the caller tracks `--current-iter`

The script does NOT auto-increment. YOU must pass `--current-iter N` on each invocation, incrementing N between calls on the same PR. Default is 1. The script enforces `--current-iter <= --max-iter` (default 3) at parse-time. If you forget to increment, the script will block you with a clear error.

### Severity reference

| Severity | Source signal | Behavior |
|---|---|---|
| **P0** | Cubic `P0:` body prefix; OR severity≥8 in `security_privacy` / `bugs_logic` | Hard block. Must fix. Gemini security-critical/security-high is advisory warning only. |
| **P1** | Cubic `P1:` body prefix; OR Cubic severity 5-7 | Hard block. Must fix. Gemini high-priority is advisory warning only. |
| **P2** | Cubic severity≥8 in non-blocking category | Soft. Fix if trivial; reply with reasoning otherwise. Gemini medium-priority is advisory only. |
| **P3** | Cubic severity 1-4; Gemini low-priority or unrecognized | Log only. |

### Protected paths (never auto-merge — manual approval required)

If your PR touches any of these, the policy gate blocks auto-merge and the PR stays open until Andrew manually merges:
- `.github/workflows/*` (CI)
- `.env*`, `**/secrets/**` (secrets)
- `*.entitlements`, `Provisioning*` (iOS signing)
- `*-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `Gemfile.lock`, `Pipfile.lock` (supply chain)
- `**/migrations/**` (database schema)
- `**/auth/**`, `**/billing/**`, `**/payment*` (high-blast-radius code)
- `**/deploy/**` (deployment config)

If your task TOUCHES one of these, that's a flag to slow down and tell Andrew before pushing.

### Exit codes

- `0` — normal signal returned on stdout. Read the signal field.
- `2` — system error: Cubic MCP unreachable, gh CLI failure, malformed response. Stop the loop. A JSON error envelope is on stderr.
- `3` — auth error: Cubic returned HTTP 401/403, or `CUBIC_API_KEY` is missing. Stop and tell Andrew to run `~/Developer/scripts/cubic-rotate-key.sh`.

### Full design + operating guide

- Architecture: `~/workspace-wiki/wiki/architecture/cubic-gemini-pr-stack.md`
- Operating guide: `~/workspace-wiki/wiki/playbooks/cubic-pr-workflow.md`
- Visual flowchart: `~/workspace-wiki/wiki/playbooks/cubic-pr-workflow.html` (open in browser)
- Empirical API findings: `~/Developer/scripts/CUBIC_API_NOTES.md`
<!-- END CUBIC-DISCIPLINE-BLOCK v2.7 -->




## Project Contract

Use `/Users/andrewnoble/AGENTS.md` as the workspace-wide contract.

This repo is the standalone DevCat CLI package for `npx devcat-cli sync`. It is public, MIT-licensed, and publishes the `devcat-cli` npm package with `devcat` and `devcat-cli` binaries pointing to the same CLI. Be especially conservative around auth, token storage, package contents, and publish actions.

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
