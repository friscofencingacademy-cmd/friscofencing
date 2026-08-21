# ADR 002: CKQ UI adoption — structure/patterns from CKQ, Frisco brand tokens

**Status:** Implemented — 2026-08-20 (Phases 0–6, `docs/plans/ckq-ui-adoption-plan.md`)

## Context

By 2026-08-20 the admin section had create+list-only CRUD (backend `PUT`/`DELETE` routes existed but no UI ever called them) and the parent portal was five independent pages sharing only a single top nav bar (`AppShell`) — no dashboard, no per-child view, no household-wide data layer. A larger, more mature reference codebase (CKQ — Chess Kings & Queens, a different platform, different business domain, different codebase, no shared deployment or database) had already solved the same structural problems: a role-gated sidebar shell, a reusable "Pattern A" CRUD dialog convention, a portal shell with per-entity nav rows, a multi-step flow-wizard kit, and a query-throws/mutation-never-throws service contract with a `useLoadState` hook + inline `LoadError` component.

## Decision

Adopt CKQ's **structural** patterns — shell geometry/breakpoints, the CRUD dialog convention, the flow-wizard component contracts, the services error-handling contract — while explicitly rejecting every one of CKQ's own visual/brand choices. Concretely:

| Adopted from CKQ (structure) | Rejected from CKQ (their brand) |
|---|---|
| Dark admin sidebar shell (220px → 64px icon-only → mobile drawer) | CKQ's navy (`#0f172a`) sidebar background |
| Sky-blue active-state pattern (color + left border + background wash) | CKQ's sky-blue (`#38bdf8`) — replaced with Frisco gold (`#C8A000`) |
| Light portal sidebar shell + mobile bottom tab bar | CKQ's own portal color choices |
| Pattern A CRUD (one dialog for create+edit, `dialog.id === null` = create; small delete-confirm dialog that flips to a "Cannot Delete" state on a 409) | — (pattern only, no CKQ-specific copy/fields carried over) |
| `useLoadState`/`getErrorMessage`/`LoadError` hook+component shapes | — (renamed/adapted generic message text; Frisco's own copy) |
| Flow-wizard kit shape (`FlowMain`/`FlowStepper`/`FlowSection`/`ChildPickerCards`/`OrderSummary`/`FlowConfirmation`) | CKQ's own flow copy, CKQ-specific fields (memberships, premium upsells — none of which exist in this product) |
| `lucide-react` icons | Outfit/Playfair-style fonts — Frisco keeps Saira/Saira Condensed throughout |

Full token-level mapping lives in the plan document's §1 brand-adaptation table (sidebar bg/text/active colors, content bg, heading/body fonts) — every value in that table was re-derived from Frisco's own `globals.css` tokens, never copy-pasted from a CKQ file.

**CSS Modules only** — no Bootstrap, no Tailwind, no MUI, consistent with the pre-existing rule in `docs/design-system.md`.

**Services contract**: query functions (`fetchX`) let errors throw; mutation functions (`createX`/`updateX`/`deleteX`/domain-specific mutations like `bookTrialClass`) never throw, always resolving to `{ status: 'success', data } | { status: 'error', message }`.

**Schedule edit/delete stays deferred** — ripple effects on already-generated `GroupClassSession` docs and student rosters make this a materially bigger change than the other four entities' CRUD, out of scope for this plan.

**Coach pages/shell are out of scope** — the coach role keeps the pre-existing top-bar `AppShell`; nothing about the coach experience changed.

## Consequences

- Admin locations/levels/prices/classes now have real edit/delete UI for the first time (backend routes existed since the original CRUD build but had no caller) — the two missing in-use delete guards this surfaced (`GroupClass` unguarded against `GroupClassSchedule` references; `Level` guarded only against `GroupClass`, not `Price`) were fixed in the same pass (Phase 2), since shipping a delete button without the guard it depends on would have been a data-integrity regression, not a UI-only change.
- The parent portal gained a real information architecture (dashboard, per-child rows/detail page, household-wide `ParentPortalContext`) instead of five flat pages — but the two payment-critical flows (book-trial, register) had to be restyled into wizards **without changing their request payloads or Stripe charge sequencing** — verified by keeping every existing payload-assertion test passing (adapted to drive the new step UI, never weakened) rather than trusting a visual review alone.
- Two independent design languages now coexist deliberately: `admin.module.css` (dark shell, "back office" feel) for admin pages, and the portal/flow modules (light shell, "member area" feel) for parent pages — `docs/design-system.md`'s "when to use which" guidance exists specifically so a future page doesn't mix them.
- `AppShell.tsx`'s per-role nav arrays are now empty for `admin`/`superadmin`/`parent` (dead code footprint, not deleted outright — coach and the logged-out visitor still use it) rather than removing the component; a future cleanup could delete the emptied branches once coach also migrates off it, but that's explicitly out of scope here.
