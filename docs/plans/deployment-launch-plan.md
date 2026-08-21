# Deployment & Launch Plan — Frisco Fencing Academy

Executable, step-by-step plan to take the locally-complete MVP live on Vercel.
Owner actions are marked **[YOU]**; Claude/code actions are marked **[CLAUDE]**.

**Never put real secrets in this file or anywhere in the repo.** Secrets live only in
local `.env` / `.env.local` files (gitignored) and the Vercel dashboard.

---

## Status

| Step | What | Status |
|---|---|---|
| 1 | GitHub repo + branches | ✅ DONE 2026-08-20 — `friscofencingacademy-cmd/friscofencing`, `main` + `develop` |
| 2 | MongoDB Atlas | ✅ DONE 2026-08-20 — free M0 cluster, `friscofencing` (prod) + `friscofencing-staging` DBs, superadmin seeded in both |
| 3 | Deploy-readiness code changes | ✅ DONE 2026-08-20 — PR #1 merged to develop |
| 4 | Vercel projects + env vars | ✅ DONE 2026-08-20 — `friscofencing` (frontend) + `friscofencing-backend`, both projects, all env vars set via API |
| 5 | Verify public home page live | ✅ DONE 2026-08-20 — staging + production both verified: home page, superadmin login, cookie flags (Secure/HttpOnly/SameSite=Lax), Atlas connectivity |
| 6 | Brevo email + parent signup verification | ⬜ |
| 7 | CKQ UI adoption (admin sidebar, parent portal, flows) | ✅ DONE 2026-08-21 — see `ckq-ui-adoption-plan.md` |
| 8 | Admin user management | ✅ DONE 2026-08-21 — see `admin-user-management-plan.md` |
| 9+ | Other deferred follow-ups | ⬜ (see bottom) |

**Production URLs:** frontend `https://friscofencing.vercel.app` · backend `https://friscofencing-backend.vercel.app`
**Staging URLs:** frontend `https://friscofencing-git-develop-frisco-fencing.vercel.app` · backend `https://friscofencing-backend-git-develop-frisco-fencing.vercel.app`

**Known gotcha (recurred 4 times across this launch — needs a real fix, not just repeated workarounds):** a fresh serverless cold start's `connectDB()` call is fire-and-forget and never retries — if the very first request lands before the MongoDB connection finishes (or right after an Atlas network-access change, or after a container has been idle long enough for Vercel to recycle it), mongoose's command buffering times out ("Operation `users.findOne()` buffering timed out") and that broken connection state persists for the container's whole lifetime, so every subsequent request on that container fails too. Workaround so far: trigger one fresh redeploy (a new cold start reconnects cleanly) — done 4 times, most recently right after the PR #13 production promotion. **Real fix, not yet done** (added to deferred follow-ups below): make `backend/api/index.js` await the connection (or add a connection-health check + reconnect-on-disconnect middleware) instead of firing `connectDB()` and immediately serving requests. Also: Vercel's "Deployment is building" placeholder page returns HTTP 200 — don't treat a 200 on `/health` as proof the build finished; check the actual JSON body.

---

## Architecture on Vercel (agreed design)

- **Two Vercel projects from the one GitHub repo**, distinguished by Root Directory:
  - `friscofencing-backend` → root `backend/` (Express app exported as a serverless function via `backend/api/index.js` + `backend/vercel.json`)
  - `friscofencing-frontend` → root `frontend/` (Next.js, auto-detected)
- **Branch ↔ environment ↔ database mapping:**

| Git branch | Vercel environment | MongoDB database |
|---|---|---|
| `main` | Production | `friscofencing` |
| `develop` | Preview (stable branch alias) | `friscofencing-staging` |

- **Cookie/auth design:** the browser only ever talks to the frontend's own domain.
  `frontend/next.config.js` rewrites `/api/v1/:path*` → `${BACKEND_URL}/api/v1/:path*`
  server-side, so the backend's httpOnly `accessToken` cookie is always first-party.
  No cross-site cookies, no CORS dependence in production.
- Every Vercel deployment is HTTPS, so the auth cookie is `secure: true` there
  (`NODE_ENV === 'production'`, which Vercel sets for both Production and Preview).

---

## Step 3 — Deploy-readiness code changes [CLAUDE]

Branch `feature/vercel-deploy-readiness` → PR to `develop`. Contents:

1. `backend/api/index.js` — serverless entry (exports the Express app, calls `connectDB()`; no `app.listen`)
2. `backend/vercel.json` — rewrite all paths to the function, preserving URLs
3. `auth.controller.js` — `secure: NODE_ENV === 'production'` cookie flag (was hardcoded `false`)
4. `backend/.env.example` + `frontend/.env.local.example` — documented env vars (`.gitignore` fixed to allow them)
5. `frontend/next.config.js` — the `/api/v1` proxy rewrite
6. `frontend/lib/api.ts` — baseURL `'/api/v1'` (relative; `NEXT_PUBLIC_API_URL` kept as override)
7. Email-send await audit (serverless must not freeze before SMTP completes)
8. Tests for all of the above

**After this merges, local dev changes once [YOU]:** in `frontend/.env.local`, replace
`NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1` with `BACKEND_URL=http://localhost:4000`.

---

## Step 4 — Vercel setup [YOU, with these exact steps]

Prereq: Vercel account connected to the `friscofencingacademy-cmd` GitHub account
(Vercel dashboard → Settings → Git → connect GitHub, grant access to the `friscofencing` repo).

### 4a. Backend project
1. Vercel dashboard → **Add New → Project** → import `friscofencing` repo
2. Project name: `friscofencing-backend`
3. **Root Directory: `backend`** (click Edit next to Root Directory)
4. Framework Preset: **Other** (no build command, no output directory — leave defaults)
5. Add Environment Variables (before first deploy; table below)
6. Deploy

**Backend env vars** (Settings → Environment Variables). Scope column says which
Vercel environments to tick when adding:

| Var | Value | Scope |
|---|---|---|
| `MONGO_URI` | Atlas URI ending in `/friscofencing` | Production only |
| `MONGO_URI` | Atlas URI ending in `/friscofencing-staging` | Preview only |
| `JWT_SECRET` | long random string — generate with `openssl rand -base64 48` (ask Claude) | Production + Preview (can differ per env) |
| `JWT_EXPIRES_IN` | `7d` | All |
| `FRONTEND_URL` | frontend prod URL (e.g. `https://friscofencing-frontend.vercel.app`) | Production |
| `FRONTEND_URL` | frontend develop alias (see 4c) | Preview |
| `STRIPE_SECRET_KEY` | `sk_test_...` (test mode until go-live decision) | All |
| `STRIPE_WEBHOOK_SECRET` | leave unset until Step 7 webhook registration | — |
| `NODEJS_HELPERS` | `0` | All — **required**: disables Vercel's body pre-parsing, which would break Stripe webhook raw-body signature verification |
| `SMTP_HOST` | `smtp-relay.brevo.com` | All (Step 6) |
| `SMTP_PORT` | `587` | All (Step 6) |
| `SMTP_USER` | Brevo SMTP login (shown on Brevo's SMTP page) | All (Step 6) |
| `SMTP_PASS` | Brevo SMTP key | All (Step 6) |
| `MAIL_FROM_ADDRESS` | verified Brevo sender (e.g. `friscofencingacademy@gmail.com`) | All (Step 6) |
| `APP_ENV` | `production` | **Production only** — leave unset (or `staging`) on Preview. Fail-closed staging email gate (`ckq-parity-plan.md` Phase 1) — anything other than `production` blocks real SMTP sends from `mail.service.js` so staging never emails a real parent. |
| `ADMIN_EMAIL` | `friscofencingacademy@gmail.com` | All |
| `LOGO_URL` | absolute logo image URL (optional) | All — omit to use the text-wordmark email header fallback |

Do NOT set `NODE_ENV` (Vercel manages it) or `PORT` (serverless). `SUPERADMIN_*` /
`COACH_*` are not needed on Vercel — seed scripts run from your machine.

### 4b. Frontend project
1. **Add New → Project** → import the same `friscofencing` repo again
2. Project name: `friscofencing-frontend` (or reuse/rename the project you already created)
3. **Root Directory: `frontend`** — Framework Preset auto-detects Next.js
4. Env vars (table below), then Deploy

| Var | Value | Scope |
|---|---|---|
| `BACKEND_URL` | backend prod URL (e.g. `https://friscofencing-backend.vercel.app`) | Production |
| `BACKEND_URL` | backend develop alias (see 4c) | Preview |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` | All |

### 4c. Stable develop URLs
Vercel gives every branch a stable alias:
`<project-name>-git-<branch>-<team-slug>.vercel.app`.
After the first develop deploy of each project, copy the exact alias from the
deployment page and use it for the Preview-scoped `BACKEND_URL` / `FRONTEND_URL`
values above (then redeploy once so they take effect).

### 4d. Production branch
Both projects: Settings → Git → Production Branch = `main` (Vercel default). `develop`
pushes create Preview deployments automatically — that is our staging.

---

## Step 5 — Verify live [CLAUDE + YOU]

1. Merge the Step 3 PR to `develop` → both projects auto-deploy previews
2. Smoke-check on the develop alias: home page renders, `/login` works against
   `friscofencing-staging` (superadmin `friscofencingacademy@gmail.com` / staging password),
   parent signup → add child → book trial
3. When satisfied: PR `develop` → `main`, verify the same on production URLs

---

## Step 6 — Brevo email [YOU then CLAUDE]

1. **[YOU]** Brevo → Settings → **SMTP & API → SMTP tab** → copy the SMTP **login** and
   generate/copy an SMTP **key**
2. **[YOU]** Brevo → **Senders & Domains → Senders** → add `friscofencingacademy@gmail.com`
   → click the confirmation link Brevo emails you
3. **[YOU]** Paste the SMTP login + key to Claude (or add the 5 SMTP env vars from the
   4a table yourself in Vercel) → redeploy backend
4. **[CLAUDE + YOU]** End-to-end verify on staging: create a parent account, add a child,
   book a trial → confirm the real email arrives (check spam folder — gmail-address
   senders often land there until a custom domain is authenticated)

---

## Step 9+ — Deferred follow-ups (in rough order)

- **[YOU]** Set `APP_ENV=production` (Production scope only), `ADMIN_EMAIL`, and `LOGO_URL`
  (optional) in the backend Vercel project per the 4a table above — added by the CKQ parity
  plan (`docs/plans/ckq-parity-plan.md`). Leaving `APP_ENV` unset on Preview is intentional:
  it is what keeps staging from emailing real parents.
- **[YOU]** Run `npm run extend-private-sessions` on a schedule once real private-class
  enrollments exist (manual for now, same model as `run-renewals.js` — see
  `docs/features/private-class.md`).
- **Fix the recurring cold-start MongoDB bug properly** (see the gotcha note above — recurred 4 times): `backend/api/index.js`'s `connectDB()` is fire-and-forget with no retry. Make the serverless entry await the connection (or add a disconnect-detecting reconnect) instead of relying on a manual redeploy every time a container goes cold. Highest-priority item on this list — it's a real production reliability bug, not just a launch-week hiccup.
- **Stripe webhook registration**: Stripe dashboard → Webhooks → add endpoint
  `https://<backend-prod-url>/api/v1/webhooks/stripe` (events: `payment_intent.succeeded`,
  `payment_intent.failed`) → put the signing secret in `STRIPE_WEBHOOK_SECRET`. Repeat
  with a second endpoint for staging if desired.
- **Renewals scheduling**: `npm run renewals` is currently manual. Options: Vercel Cron
  (needs an HTTP endpoint wrapper + auth guard) or run monthly from this machine. Decide
  when first real subscription exists.
- **Custom domain**: buy via Vercel or any registrar → add to frontend project. Then
  authenticate the domain in Brevo (DKIM/SPF) and switch `MAIL_FROM_ADDRESS` to
  `noreply@<domain>` for deliverability.
- **Stripe live keys**: swap test → live keys when real payments should start.
- **CI**: GitHub Actions (build + tests on PRs), mirroring the CKQ model, once change
  volume justifies it.
- **Atlas hygiene**: delete the `sample_mflix` demo database; consider IP allowlist
  tightening + a read-only DB user later.
- **Minor cleanup**: `frontend/app/admin/dashboard/page.tsx` fetches `fetchPrices()` but
  never displays it (harmless leftover from the CKQ UI adoption plan, flagged in its
  final report — one extra parallel network call, no incorrect data shown).
- **Test coverage gaps** (logged honestly in `docs/TEST_COVERAGE.md`, not hidden): new
  tests from the UI adoption plan use `fireEvent` instead of the `userEvent`-only rule
  documented in `TESTING_STRATEGY.md` — not retrofitted; a few files lack dedicated unit
  tests (`user.routes.js` route file itself, `billingDates.js`); `AppShell.tsx` still has
  zero direct test coverage (pre-existing, coach pages only use it now).
