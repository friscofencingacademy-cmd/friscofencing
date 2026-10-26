---
name: health
description: Frisco Fencing repository and environment health check — git and branch state, CI, branch protection, last E2E, session-extension and live-audit runs, and staging/production data health. Read-only.
---

# /health — Frisco Fencing health check

**Run every step in order, autonomously. Do not ask questions. Do not pause. Do not write,
commit, push, run tests, or switch branches.** Read and report only. Designed in
`docs/plans/audit-and-health-refresh-plan.md` (PR 3).

Repo: `friscofencingacademy-cmd/friscofencing` (one repo: `backend/`, `frontend/`, `audit/`).
Today in Central: `TZ=America/Chicago date +%Y-%m-%d`.

---

## Step 1 — Fetch

```bash
git fetch origin --prune
```

## Step 2 — Local state

```bash
git branch --show-current
git status --short                                                   # blank = clean
git log "origin/$(git branch --show-current)..HEAD" --oneline 2>/dev/null   # unpushed
git log "HEAD..origin/$(git branch --show-current)" --oneline 2>/dev/null   # unpulled
```

Flag a dirty tree, unpushed commits and unpulled commits.

## Step 3 — `develop` health

```bash
git log develop..origin/develop --oneline    # local develop behind
git log origin/develop..develop --oneline    # local develop AHEAD — direct commits, a rule violation
```

## Step 4 — `develop` → `main` gap

```bash
git log origin/main..origin/develop --oneline
```

Report the count. Promotion to `main` needs explicit owner approval (CLAUDE.md); list any
promotion prerequisites still open in `CLAUDE.md`'s Documentation Map rows (for example a
production migration or env var) — quote the row, do not guess.

## Step 5 — Open pull requests

```bash
gh pr list --state open --json number,title,baseRefName,headRefName,isDraft
```

## Step 6 — CI on `develop`

```bash
gh run list --workflow=ci.yml --branch develop --limit 3 --json databaseId,conclusion,createdAt,headSha,displayTitle
gh run view <newest databaseId> --json jobs --jq '.jobs[] | {name, conclusion}'
```

Report each job (`backend-tests`, `frontend-tests`, `e2e-tests`, `ci-passed`). For the E2E job,
the pass/skip line:

```bash
gh run view <id> --log --job <e2e job id> | grep -E "[0-9]+ (passed|skipped|failed|flaky)" | tail -4
```

Flag any non-success, any `failed`/`flaky` count, and more than the 4 known visual-baseline skips.

## Step 7 — Branch protection

```bash
gh api repos/friscofencingacademy-cmd/friscofencing/branches/develop/protection --jq '.required_status_checks.contexts' 2>&1
gh api repos/friscofencingacademy-cmd/friscofencing/branches/main/protection --jq '.required_status_checks.contexts' 2>&1
```

Expected on both: exactly `["ci-passed"]` (`.github/workflows/ci.yml` explains why one umbrella
check). Flag "Branch not protected", a missing `ci-passed`, or per-job contexts instead of it.

## Step 8 — Scheduled jobs

```bash
gh run list --workflow=extend-sessions.yml --limit 1 --json conclusion,createdAt,event
gh run list --workflow=live-audit.yml --limit 1 --json conclusion,createdAt,event
```

Flag: never run, last run more than 8 days ago (both are weekly), or not `success`. A run whose log
says "secret is not set — skipping" succeeded without doing anything — report it as **not
configured**, not as healthy:

```bash
gh run view <id> --log | grep -m1 "secret is not set" || true
```

## Step 9 — Staging data

```bash
cd backend && npm run health -- --env staging
```

Print its output verbatim. It checks upcoming group sessions per schedule, the Service registry,
leftover legacy payment fields, cards on an inactive provider, ledger rows stuck in `pending`,
subscriptions at retry exhaustion, one active subscription per student, orphaned private-lesson
references, the live-audit fixtures, and the age and result of the last live audit. Exit 1 means at
least one ❌.

If `backend/.env` has no staging `AUDIT_MONGO_URI`, report "staging data: not checked (no
AUDIT_MONGO_URI)" — never point it at another database.

## Step 10 — Production data

Only when `backend/.env.production.local` exists on this machine:

```bash
cd backend && npm run health -- --env production
```

It is read-only (`scripts/lib/healthCheck.js` only finds and counts; its test proves no write
method is called). If the file is absent, or the run is not permitted here, print the command for
the owner to run and report "production data: not checked".

---

## Output format

```
════════════════════════════════════════
 FRISCO FENCING HEALTH — <date, Central>
════════════════════════════════════════
Branch        : <name>
Local state   : <clean | N uncommitted | N unpushed | N unpulled>
Develop       : <in sync | N behind | ⚠️ N ahead — direct commits>
→ main gap    : <N commits | in sync>  <open promotion prerequisites, if any>
Open PRs      : <#N title (base) | none>
CI (develop)  : <date> backend ✅ frontend ✅ e2e ✅ (95 passed, 4 skipped) ci-passed ✅
Protection    : develop <["ci-passed"] | ⚠️ …>   main <["ci-passed"] | ⚠️ …>
Extend sessions: <date — success | ⚠️ not configured | ⚠️ never run | ❌ failed>
Live audit    : <date — success | ⚠️ not configured | ⚠️ stale | ❌ failed>

STAGING DATA
  <health-check output>

PRODUCTION DATA
  <health-check output | not checked — run: cd backend && npm run health -- --env production>

────────────────────────────────────────
ACTION ITEMS
────────────────────────────────────────
<one line per problem, most severe first, each with the command or doc that fixes it>
<or: ✅ All healthy>
════════════════════════════════════════
```

## What counts as an action item

- Any ❌ from Step 9 or 10, then any ⚠️.
- A dirty tree, unpushed or unpulled commits, local `develop` ahead of `origin/develop`.
- A failing or flaky CI job on `develop`; more skips than the known 4.
- `develop` or `main` not requiring exactly `ci-passed`.
- A scheduled job never run, not configured, failed, or older than 8 days.
- An open PR other than in-flight feature work (say which).
