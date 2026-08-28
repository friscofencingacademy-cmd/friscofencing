# Implementation plan: Audit skills refresh (post billing-anchor + sibling-discount plan)

**Status:** DRAFT — for owner review, not yet built. No code has been touched for this plan.
**Triggered by:** owner noticing the live audit skills (`/audit-live-registration`, `/reset-audit-data`) might be stale after the 3-PR billing plan (`docs/plans/billing-anchor-and-sibling-discount-plan.md`) shipped calendar-month billing, the one-active-subscription guard, create-pending-first registration, and the sibling-discount family rule.
**Scope decided by owner:** full update — fix what's wrong, simplify what a shipped change made unnecessary, and add live coverage for the two genuinely new user-facing paths those PRs introduced.

---

## 0. What's actually stale (verified against current source, not assumed)

| # | File(s) | What's wrong | Why |
|---|---|---|---|
| F1 | `backend/scripts/audit-reset.js` (its own header comment) + `.claude/skills/reset-audit-data/SKILL.md` | Both justify hard-deleting the 4 audit student documents by saying "registration.service.js's Stripe idempotency key is `initial-registration-${studentId}-${scheduleId}`, cached 24h, so reusing the same student+schedule collides." **That key format no longer exists.** PR 2 (`docs/decisions/008-registration-create-pending-first.md`) replaced it with `payment_${row._id}`, generated fresh from a brand-new `SubscriptionCycleRegistration` row created every time `create()` runs. | Since the reset script already deletes the `Registration`/`Subscription` docs, the next registration attempt creates a fresh ledger row with a fresh `_id` — there is no possible collision with an old Stripe key tied to a deleted document. The delete-and-recreate-the-student step was solving a problem that no longer exists. |
| F2 | `.claude/skills/audit-live-registration/SKILL.md` (S2 row) | Pass criterion says `Registration.status === 'active'`. | `Registration` (the payment ledger, `backend/src/models/registration.model.js`) has never had an `'active'` status — its `REGISTRATION_STATUSES` are `pending`/`completed`/`failed`. `'active'` is a `Subscription` status. Pre-dates the billing-anchor plan; unrelated to it, just wrong. |
| F3 | `audit/scenarios/s3-sibling-discount.js` (coverage gap, not incorrect) | Only exercises a new child registering as the family's **lower** payer (the "own-fee" case — still correct and passing under the new rule). | PR 3 (`docs/decisions/006-sibling-discount-family-rule.md`) added a genuinely new path: a new child registering as the family's **higher** payer now also gets 10% off immediately (the "bridge" case), with its own distinct on-screen reason text. Zero live coverage of this real, money-affecting path today. |
| F4 | (missing entirely — coverage gap) | No scenario exercises a registration whose first charge fails. | PR 2 added a new user-facing state: a declined charge on `create()` no longer returns an error — it returns `201`/"Registration received" and enters the same retry/dunning a failed renewal uses (`docs/decisions/008-registration-create-pending-first.md`). S4 only covers a card declining at the **payment-method save** step (`POST /payment-methods`), a different code path from a card declining at the **registration charge** itself. |
| F5 | `docs/TESTING_STRATEGY.md`'s "Available scripts" table | Lists only the S1–S4 flow and the 3 existing seeded accounts. | Will be stale the moment F3/F4's new scenarios/accounts exist (D3/D4 below). |

**Checked, not stale:** `docs/features/admin.md`'s Audits section (describes the report page only, no scenario/idempotency detail to go wrong). `backend/scripts/audit-seed.js` (no billing-logic assumptions — just creates accounts/classes/prices). `docs/plans/audit-system-plan.md` is a historical build record — left untouched; this plan supersedes its D5 and Phase 3 scenario list going forward, addended rather than rewritten (D6 below).

---

## 1. Design decisions

### D1 — Simplify `audit-reset.js`: stop deleting student documents

Remove the `User.deleteMany({_id: {$in: studentIds}})` step and its justifying comment entirely. The reset still deletes, for the 4 fixed audit students: `TrialClass`, `Registration`, `Subscription`, their roster entries (`GroupClassSchedule.students` `$pull`), and `Visit` docs — exactly as today, just without touching the `User` documents themselves. Also still clears the 3 audit parents' `PaymentMethod` (+ Stripe detach) — unrelated to this fix, unaffected.

Consequence: **`npm run audit:seed` no longer needs to run again after a reset** — the student accounts persist across resets now (they're never deleted), so `findOrCreateUser`'s idempotency check in `audit-seed.js` just confirms they still exist. This removes a required step from the owner's own workflow, not just a code simplification.

Updated header comment states the current idempotency key (`payment_${row._id}`, keyed on a fresh ledger row every `create()` call) and explains plainly why no student-identity churn is needed anymore.

**Verification recommended (not a launch blocker, but flagged honestly):** this reasoning is sound from reading the current `chargeFinalization.service.js`/`registration.service.js` source, but the *only* way this codebase's own history has ever fully trusted an idempotency-key claim is by running it for real against staging (`docs/plans/audit-system-plan.md`'s own addendum — F1 above exists precisely because the first version of this reasoning was wrong once already). Recommend the owner's first post-this-plan audit run double as confirmation that a reset → immediate re-run never hits a Stripe idempotency collision.

### D2 — Fix `audit-live-registration/SKILL.md`'s S2 pass criterion

`Registration.status === 'active'` → `Subscription.status === 'active'` (and, since the create-pending-first change means a *successful* charge's ledger row is `'completed'` while the Subscription itself is `'active'`, state both explicitly: "the `Subscription` is `active` and its ledger `Registration` row is `completed`").

### D3 — New S5: sibling discount, the BRIDGE case

Owner-relevant scenario PR 3 added: a new child who is the family's **higher** payer still gets the family discount immediately, based on the *existing* sibling's lower fee.

**Seed additions** (`backend/scripts/audit-seed.js`): one new parent, `audit-bridge-parent@example.com`, with two children — `BridgeFirst` and `BridgeSecond` — reusing the same two existing audit classes (Level A $100 "pricier", Level B $50 "cheaper"; no new Level/Price/Schedule needed).

**New scenario file** `audit/scenarios/s5-sibling-discount-bridge.js`, modeled on `s3-sibling-discount.js`'s structure but with the registration order reversed relative to S3 on purpose — this is what actually exercises the new path:
1. Register `BridgeFirst` into the **cheaper** Level B first (no sibling yet — no discount expected, same as any first registration).
2. Register `BridgeSecond` into the **pricier** Level A second. Expect: the live preview shows the discount (not "no discount," which is what the OLD rule would have shown for a higher payer), the confirmation screen shows "Sibling Discount" with the bridge-specific reason text ("Your family's 10% sibling discount applies to this registration, based on your other child's lower-priced plan."), and preview/reality still never disagree.

Reuses `s3-sibling-discount.js`'s `registerChild()` helper verbatim (extract it to a small shared `audit/lib/register-child.js` so S3 and S5 both import it, rather than duplicating the Playwright steps — the two scenarios differ only in account/order/expected-reason, not in mechanics) plus one addition: assert the specific reason text differs between the "own-fee" and "bridge" cases, since that distinction is the whole point of ADR 006's "mark."

**Reset script**: add `BridgeFirst`, `BridgeSecond` to `AUDIT_STUDENT_LAST_NAMES`, `audit-bridge-parent@example.com` to `AUDIT_PARENT_EMAILS`.

### D4 — New S6: a declined registration charge enters retry, not an error

Exercises `docs/decisions/008-registration-create-pending-first.md`'s core new behavior through a real browser and a real Stripe TEST-mode decline-at-charge-time.

**Seed additions**: one new parent, `audit-retry-parent@example.com`, with one child, `RetryChild`.

**New Stripe test card** (`audit/lib/stripe-card.js`'s `STRIPE_TEST_CARDS`): add `chargeDeclineOnly: '4000000000000341'` — Stripe's documented test number for "attaches to a Customer successfully, but a subsequent charge attempt with it fails." This is distinct from the existing `decline: '4000000000000002'` (declines even at `attach()`, per this repo's own D_addendum finding) — **flag for verification on the first real run**, same "don't just trust the reasoning" discipline as D1: confirm this card actually saves successfully via `POST /payment-methods` before relying on it to isolate a charge-time-only decline.

**New scenario file** `audit/scenarios/s6-charge-decline-retry.js`:
1. Log in as `audit-retry-parent`, save the new `chargeDeclineOnly` card (expect success — this is the point of using this specific card, unlike S4's).
2. Attempt group-class registration for `RetryChild` into either audit level.
3. Expect: the wizard does **not** show an error — it reaches step 2 (`Registration received`, not `Registration complete!`), matching the frontend's new `paymentStatus: 'pending'` branch (`frontend/app/parent/register/page.tsx`).
4. Verify via an authenticated API call in the same browser context (`GET /registrations/mine`, matching this repo's existing "verify honestly, not via a DB peek" convention) that the subscription is `active` with `retryCount >= 1` and that the wizard's confirmation copy matches the "we'll automatically retry" wording — never a raw error.

**Reset script**: add `RetryChild` to `AUDIT_STUDENT_LAST_NAMES`, `audit-retry-parent@example.com` to `AUDIT_PARENT_EMAILS`.

**Not in scope for S6**: waiting out the actual 3-day retry/cancel-after-exhaustion cycle live — that's already covered by the real Jest integration tests added in PR 2/PR 3 (`renewal.service.test.js`, `registration.routes.test.js`). S6's job is only to prove the *live, real-browser, real-Stripe* first-attempt UX is correct, matching this audit layer's actual purpose (`docs/TESTING_STRATEGY.md`'s two-layer table: Jest catches logic, live audits catch real auth/Stripe/cross-service wiring).

### D5 — Orchestrator + docs updates

- `audit/run-registration-audit.js`: `SCENARIOS = [s1, s2, s3, s4, s5, s6]`. Report format/console table extend naturally (already data-driven off the `results` array — no hardcoded "4" anywhere to chase).
- `.claude/skills/audit-live-registration/SKILL.md`: add S5/S6 rows to the scenario table (D2's fix included), update the seeded-accounts list, update the "Notes" section if anything else references "4 scenarios."
- `.claude/skills/reset-audit-data/SKILL.md`: remove the "delete student, must reseed" language (D1), update the fixed-account list to include the two new parents' children, update "What it clears."
- `docs/TESTING_STRATEGY.md`'s "Available scripts" table: update the Flow/Accounts columns to mention S5/S6 and the 5 parent accounts.

### D6 — `docs/plans/audit-system-plan.md`: addended, not rewritten

That file is a historical build record (its own header says "APPROVED FOR AUTONOMOUS EXECUTION," a past, closed process). Add one short addendum at its end pointing at this plan and stating D5 (the reset script's original design) and the Phase 3 scenario list (S1–S4) are superseded by this plan's D1/D3/D4 — same pattern already used for ADR 001/registration-ledger-plan.md when the billing-anchor plan superseded pieces of them.

---

## 2. Files touched

| File | Change |
|---|---|
| `backend/scripts/audit-seed.js` | Add `audit-bridge-parent` (+2 children), `audit-retry-parent` (+1 child) |
| `backend/scripts/audit-reset.js` | Remove student-delete step + stale comment (D1); extend `AUDIT_STUDENT_LAST_NAMES`/`AUDIT_PARENT_EMAILS` (D3/D4) |
| `audit/lib/stripe-card.js` | Add `chargeDeclineOnly` test card constant |
| `audit/lib/register-child.js` | New — extracted from `s3-sibling-discount.js`, shared by S3 and S5 |
| `audit/scenarios/s3-sibling-discount.js` | Refactor to import the shared helper; no behavior change |
| `audit/scenarios/s5-sibling-discount-bridge.js` | New (D3) |
| `audit/scenarios/s6-charge-decline-retry.js` | New (D4) |
| `audit/run-registration-audit.js` | Register S5/S6 in `SCENARIOS` |
| `.claude/skills/audit-live-registration/SKILL.md` | Fix S2 (D2), add S5/S6 rows, update account list |
| `.claude/skills/reset-audit-data/SKILL.md` | Remove delete/reseed step (D1), update account list |
| `docs/TESTING_STRATEGY.md` | Update "Available scripts" table |
| `docs/plans/audit-system-plan.md` | Short superseding addendum (D6) |

No `backend/`/`frontend/` Jest suites are touched — this plan only changes the `audit/` Playwright package, its two wrapper skills, `backend/scripts/audit-{seed,reset}.js`, and docs. Consistent with the existing convention (`docs/plans/audit-system-plan.md` Phase 3): the Playwright scenario scripts and the seed/reset scripts get no Jest coverage, verified instead by a real run against staging — noted explicitly, not a silent gap.

---

## 3. Verification plan (owner-run, not autonomous)

This plan cannot be verified by `npm test` — every change here either talks to real staging MongoDB or drives a real browser against real Stripe TEST-mode. The build-and-verify sequence:

1. `cd backend && npm run audit:seed` — confirm it reports the 2 new parents/3 new children created (or "already exists" on a re-run).
2. `cd backend && npm run audit:reset` — confirm the console output no longer mentions deleting/recreating student documents, and confirm (via the staging DB or the next seed run) the 6 audit student accounts still exist afterward.
3. `cd audit && npm run audit:registration` — expect **6/6 scenarios passing** on a clean run. Specifically confirm:
   - S5's `BridgeSecond` registration shows the discount preview + the bridge-specific reason text, not the S3 wording.
   - S6's `chargeDeclineOnly` card actually saves (if it doesn't, D4's flagged assumption was wrong and needs a different Stripe test card — check first, don't silently swap it).
   - Re-running `audit:reset` then `audit:registration` immediately again (no `audit:seed` in between) succeeds cleanly — the direct test of D1's core claim.
4. Confirm the run reports to `/admin/audits` on staging with 6 scenario rows.

---

## 4. Builder instructions

1. **Pre-reads:** this plan in full; `docs/decisions/008-registration-create-pending-first.md` and `006-sibling-discount-family-rule.md` (the two ADRs this plan is reconciling audits against); `docs/plans/audit-system-plan.md` (original design + its own addendum, for tone/convention); every file this plan touches, read before editing (per `CLAUDE.md`'s hard rule).
2. **Branch:** `git checkout develop && git pull && git checkout -b feature/audit-skills-refresh` (or owner's preferred name).
3. **Order:** D1 (simplify reset) → D2 (fix S2 wording) → D3 (S5) → D4 (S6) → D5 (orchestrator + skill docs) → D6 (addendum). Each is independently meaningful; do not skip D1's verification step (§3.3's re-run-without-reseeding check) since it's the one piece of reasoning in this whole plan that hasn't been proven live yet.
4. **This is owner-triggered tooling, not app code** — no `develop`-merge urgency, no automated test gate to satisfy. The real gate is a clean, owner-observed run against staging per §3.
5. **Report back:** files touched, the real console output of the seed/reset/audit runs (not paraphrased), and explicitly whether D1's and D4's flagged assumptions (idempotency-key reasoning; the `chargeDeclineOnly` card number) held up on the real run or needed correction — matching this repo's own established audit-plan convention of recording what a live run actually found, not just what was designed.
