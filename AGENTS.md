# AGENTS.md

<!-- BEGIN SIGNED-REVIEW-DISCIPLINE-BLOCK v1 -->
## Automated PR Review — required

Every repo change uses the signed exact-head review lane unless Andrew explicitly says `commit directly` or `skip the PR` for that one task. Never push directly to `main`. A draft PR registers work; marking it ready submits it for merge.

### Required loop

1. Start from fresh `origin/main` on a feature branch.
2. Run focused tests, relevant full verification, and `git diff --check`.
3. Commit and push the branch, then open a draft PR.
4. Run `review-self-check --pr <num> --repo AnobleSCM/<name> --runtime <runtime> --current-iter 1`.
5. Fix every P0/P1 or `must-fix` finding, push the new head, increment `--current-iter`, and rerun. Never reuse a clean signal after a push.
6. Mark ready only after `signal: clean` for the exact current head.
7. Run `review-self-check --pr <num> --repo AnobleSCM/<name> --runtime <runtime> --current-iter <next> --watch` and wait for a terminal gate result.

P0/P1 findings block merge. P2/P3 findings are advisory unless they reveal a concrete safety, correctness, privacy, or data-loss risk. `reviewers-unavailable` is an infrastructure condition, not permission to skip review; retry the signed fallback lane or use the approved provider failover.

### Protected paths

Changes to workflows, secrets or environment handling, signing material, dependency manifests or lockfiles, migrations, auth, billing or payments, deployment, rulesets, fleet rollout, hosted runtime, or credential mutation require two independent non-author AI reviewer families, exact-head signed protected-path receipts, and an honest AI-authorization note before merge. Never claim human review that did not occur.

### Continuity

The reusable GitHub gate validates the signed exact-head fallback receipt. Gemini may be advisory but is not sufficient by itself. External reviewer pauses do not waive the gate, and Andrew is not asked to review or merge code.
<!-- END SIGNED-REVIEW-DISCIPLINE-BLOCK v1 -->


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
