# AGENTS.md

<!-- BEGIN SIGNED-REVIEW-DISCIPLINE-BLOCK v2 -->
## Automated PR Review — required

Every repository change uses the signed exact-head review lane unless Andrew explicitly says `commit directly` or `skip the PR` for that one task. Never push directly to `main`. A draft PR registers work; marking it ready submits it for merge.

Before opening or advancing a PR, verify the operator runtime supplies the wrapper with `command -v review-self-check`; if it is missing, stop and repair the reviewer installation rather than bypassing the gate. The installed `review-self-check` wrapper is external operator tooling (not part of the published npm package). It invokes independent fallback reviewers, records a signed receipt bound to the repository, PR number, and exact head SHA, and reports one of `clean`, `must-fix`, `escalate`, or `reviewers-unavailable`. Only `clean` for the current head permits readiness. Exit code `0` means a normal JSON signal was returned and the signal still must be read; exit code `2` means a provider, GitHub, transport, or parsing system error; exit code `3` means an authentication error. Codes `2` and `3` stop the loop. The installed pre-merge hook enforces the same contract; do not disable or bypass it.

### Branch hygiene

1. Fetch `origin` and create a feature branch from fresh `origin/main`.
2. If the PR becomes stale, fetch again, rebase onto `origin/main`, resolve conflicts, rerun verification, and push with `--force-with-lease`.
3. After merge, update local `main`, delete the merged feature branch, and prune any temporary worktree.

### Required loop

1. Run focused tests, relevant full verification, and `git diff --check`.
2. Commit and push the feature branch, then open a draft PR.
3. Run `review-self-check --pr <num> --repo AnobleSCM/<name> --runtime <runtime> --current-iter 1`.
4. Interpret the result:
   - `clean`: the exact current head may be marked ready.
   - `must-fix`: fix every blocking finding, commit and push, increment `--current-iter`, and rerun. A prior receipt is invalid after any push.
   - `escalate`: the iteration budget is exhausted; keep the PR draft and resolve the named escalation before continuing.
   - `reviewers-unavailable`: this is an infrastructure failure, not permission to skip review. Retry the signed fallback lane or use the approved provider failover.
   - authentication, transport, malformed-output, or command-not-found errors: stop remote movement, repair the reviewer infrastructure, and rerun; never reinterpret an error as `clean`.
5. Mark ready only after `signal: clean` for the exact current head.
6. Run `review-self-check --pr <num> --repo AnobleSCM/<name> --runtime <runtime> --current-iter <next> --watch` and wait for a terminal gate result. A failed gate returns to step 4; a successful terminal result permits the configured merge-authority path to merge.

P0/P1 findings block merge. P2/P3 findings are advisory unless they reveal a concrete safety, correctness, privacy, security, or data-loss risk.

### Protected paths

Changes to any of the following require exact-head signed coverage from at least two distinct substantive non-author AI reviewer families plus an honest AI-authorization note before merge. A reviewer family is the signed provider/runtime identity in the receipt: the author runtime is excluded, and duplicate identities do not count twice:

- `.github/workflows/**`, merge rules, auto-approve logic, and rulesets;
- `.env*`, `**/secrets/**`, credentials, signing material, and runtime configuration;
- dependency manifests and lockfiles;
- database migrations;
- authentication, authorization, billing, payments, and deployment code;
- fleet rollout, hosted runtime, production mutation, or similarly high-blast-radius surfaces.

Never claim human review that did not occur. Andrew is not asked to review, approve, or merge code.

### Continuity

Because this repository is public, `.github/workflows/agent-pr-gate.yml` vendors the v4 gate locally and pins its helper checkout to source commit `c9f885fafa3ba6f95fa9075a38d331b02c311a55`. That workflow validates the signed exact-head fallback receipt and protected-path quorum. Advisory reviewers may add signal but cannot satisfy the gate alone. External reviewer pauses do not waive the signed fallback requirement, and a self-review by the author runtime is never sufficient.
<!-- END SIGNED-REVIEW-DISCIPLINE-BLOCK v2 -->


## Project Contract

Follow the workspace-wide instructions supplied by the active runtime before this repository file.

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
