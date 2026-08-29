# Shared Modal Component Plan

**Status:** BUILT 2026-08-29, pending owner local testing + review (see Completion Notes at the end)
**Branch:** `feature/shared-modal-component` → PR to `develop`
**Scope:** One PR. New shared component + tests, then a mechanical migration of every
existing dialog to it, then CSS/doc cleanup.

---

## 0. Executor instructions — read this first

This plan is written to be executed by a separate Claude session. Non-negotiables:

1. **Follow `CLAUDE.md`'s HARD RULES exactly.** Discuss anything ambiguous before writing
   code; the word `write` from the owner is the only implementation trigger; write tests
   before considering any step complete; **never auto-commit** — the owner tests locally
   first; never auto-fix a test failure (show summary + root cause + fix plan, stop); no
   `any` on domain data; stage files explicitly (never `git add .`).
2. **Pre-reads before touching code:**
   - `docs/design-system.md` — this adds a new shared UI component and a new anti-pattern
     entry; §"Components inventory" and §"Anti-patterns" are what's being extended.
   - `docs/TESTING_STRATEGY.md` — before writing/modifying any test.
   - `docs/features/admin.md` — Pattern A CRUD pages are the majority of what's migrated.
   - `docs/features/parent-portal.md` — `AddChildModal` is in scope too (§4h below).
3. **Read every file before editing it.** Every line number below is from 2026-08-29 and
   is a pointer, not gospel — re-verify with the same `grep`/`Grep` calls this plan used
   before trusting a specific line.
4. **Migrate one file, re-run that file's own existing test suite, then move to the
   next** (§6's execution note) — this is a 13-file mechanical refactor; catching a
   mistake immediately, file by file, is far cheaper than debugging a batch failure at
   the end.

---

## 1. Problem & goal

Reported by the owner: in the admin panel, clicking anywhere outside an open edit/create
dialog closes it immediately and silently discards everything typed into the form. The
request is to require an explicit close (the dialog's `X`, the `Esc` key, or its `Cancel`
button) — and, explicitly, to fix this **once, sitewide**, not by patching each dialog's
handler individually.

**Root cause, confirmed by audit (not assumed):** there is no shared modal/dialog
component in this codebase. Every dialog is a hand-rolled JSX block — an `overlay` div
with its own `onClick={(e) => e.target === e.currentTarget && <close call>}` handler,
copy-pasted independently into **13 files, 25 separate dialog instances** (audit table in
§4). No dialog anywhere listens for `Escape`. The guard condition protecting an in-flight
save varies by copy-paste lineage (`!saving`, `!deleting`, `!submitting`, `!slotSaving`) —
already a sign this was never meant to be maintained in 13 places. The CSS backing this
markup is *also* duplicated: `admin.module.css` and `AddChildModal.module.css` each
independently define `.overlay`/`.dialog`/`.dialogHeader`/`.dialogTitle`/`.dialogClose`/
`.dialogBody`/`.dialogFooter` with the same names and near-identical rules.

**Goal:** one shared `Modal` component that owns the overlay, the dialog frame, the `X`
button, and the `Escape` handler — with **no backdrop-click-to-close at all** — that
every one of the 25 instances renders through. Fixing the bug in the shared component
fixes it everywhere, and a dialog added in the future gets the correct behavior for free
just by using `Modal` instead of hand-rolling a new overlay `div`.

## 2. Decision

Build `Modal` in `frontend/app/components/ui/Modal/` (same location/naming convention as
`Button`, `Alert`, `Card`, `LoadError` — `Modal.tsx` + `Modal.module.css` +
`__tests__/Modal.test.tsx`), styled from `admin.module.css`'s existing `.overlay`/
`.dialog*` rules (the more complete of the two duplicated definitions — it already has
`.dialogSm` and the `.dialogClose:hover` state `AddChildModal.module.css` lacks). Every
one of the 25 existing dialog instances is migrated to render through it; the now-dead
duplicated CSS is deleted from both `admin.module.css` and `AddChildModal.module.css`
once verified unreferenced.

No backend involvement, no data migration — this is a frontend-only structural refactor.
No ADR needed (a UI component extraction, not a business-logic/billing decision) — this
plan doc is the record, same as the Flow-kit/marketing-kit components before it.

### Why one shared component, not a hook

A hook (e.g. `useModalClose()`) would still leave the actual `overlay`/`dialog` JSX
duplicated 25 times — the exact problem statement calls that out ("not just duplicated
for each box"). A full component is what `docs/design-system.md`'s existing anti-pattern
#2 already establishes as the house style ("Hand-rolled `.btnPrimary`-style class in a
page's own module. Import `Button`.") — this plan adds the equivalent rule for dialogs
(§5c).

## 3. `Modal` component design

### 3a. Props

```ts
export interface ModalProps {
  /** Whether the modal is open. Modal renders nothing at all when false — callers drop
   *  their own `{x.open ? <dialog markup> : null}` ternary and just pass `open`. */
  open: boolean;
  /** Called on X click or Escape — never on a backdrop click (there is no backdrop
   *  click handler in this component at all; that omission IS the fix). */
  onClose: () => void;
  /** Dialog title, rendered in the header. */
  title: string;
  /** Accessible name for role="dialog"; falls back to `title` when omitted — every
   *  existing call site already has an equivalent aria-label or an OK-to-reuse title. */
  ariaLabel?: string;
  /** 'md' (default, 500px) or 'sm' (380px, today's `.dialogSm`) — confirm/secondary
   *  dialogs use 'sm'. */
  size?: 'md' | 'sm';
  /** Hides the header's X button entirely. Every pure delete-confirm dialog audited in
   *  §4 has no X today (Cancel/Delete or a single Close button in the footer is the only
   *  way out) — preserve that exactly; do not add an X to those as part of this PR
   *  (scope discipline — a real UX call, not this plan's to make silently). Dialogs that
   *  are a genuine secondary FORM (e.g. Change Password) keep their X — see §4's table
   *  for which is which per instance. */
  hideCloseButton?: boolean;
  /** True while an in-flight save/delete is happening — disables the X and makes Escape
   *  a no-op, replacing the various per-page `!saving`/`!deleting`/`!submitting`/
   *  `!slotSaving` guards. The caller's own footer Cancel/Save buttons keep managing
   *  their own `disabled` state exactly as today — Modal does not own footer content. */
  disableClose?: boolean;
  /** Dialog body content. */
  children: React.ReactNode;
  /** Dialog footer content (typically Cancel + a primary action). Omit for a modal with
   *  no footer — none of the 25 audited instances need this, but keep it optional rather
   *  than assume every future modal has one. */
  footer?: React.ReactNode;
}
```

### 3b. Behavior

- **No backdrop-click handler exists at all** — not "guarded," genuinely absent. This is
  the fix; do not add an opt-in `closeOnBackdropClick` escape hatch that could quietly
  regress back to today's bug on some future call site.
- **Escape** closes via a `useEffect` that attaches `document.addEventListener('keydown',
  ...)` only while `open` is true, and only calls `onClose()` when `!disableClose`;
  cleans up its listener on close/unmount. Fires regardless of `hideCloseButton` — a
  confirm dialog has no form data to lose, so Escape-as-cancel is safe and consistent
  there too, and there's no reason a keyboard user should have a worse escape route than
  a mouse user on those dialogs.
- **X button** calls `onClose()`, is `disabled={disableClose}`, and is not rendered at all
  when `hideCloseButton` is true.
- **`role="dialog"` + `aria-modal="true"`** on the dialog frame (`aria-modal` is currently
  missing on every existing instance — a correct, essentially free a11y addition since
  every dialog is being touched anyway) and `aria-label={ariaLabel ?? title}`.
- **Focus**: on open, capture `document.activeElement` and move focus into the dialog
  frame (a `ref` + `.focus({ preventScroll: true })` on the dialog container, which needs
  `tabIndex={-1}` to be focusable); on close, restore focus to the captured element. This
  is genuinely free (lives entirely inside `Modal`'s own effect, zero caller changes) and
  a real accessibility improvement no existing dialog has today.
- **Explicitly OUT OF SCOPE, logged honestly rather than silently skipped**: full focus
  **trapping** (cycling Tab/Shift+Tab among only the dialog's own focusable elements so
  focus can't escape to the page behind it). That's a materially bigger, separate a11y
  task or a case for pulling in a small dependency (e.g. `focus-trap-react`) — a real
  decision this plan doesn't make unilaterally. Track it as a known follow-up in
  `docs/TEST_COVERAGE.md`'s Improvement Plan the same way the `fireEvent`-vs-`userEvent`
  gap is tracked there today, not silently dropped.

### 3c. Sketch

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

export default function Modal({
  open, onClose, title, ariaLabel, size = 'md', hideCloseButton, disableClose, children, footer,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !disableClose) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose/disableClose read
    // fresh via closure each keydown; re-subscribing on their change is correct but
    // verify against this repo's actual eslint config before assuming the disable is
    // needed at all.
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`${styles.dialog} ${size === 'sm' ? styles.dialogSm : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
      >
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>{title}</h2>
          {!hideCloseButton ? (
            <button
              type="button"
              className={styles.dialogClose}
              onClick={onClose}
              disabled={disableClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        <div className={styles.dialogBody}>{children}</div>
        {footer ? <div className={styles.dialogFooter}>{footer}</div> : null}
      </div>
    </div>
  );
}
```

This is a sketch, not final code — the executor writes the real file, verifies the
`eslint-disable` comment is actually warranted against this repo's real ESLint config
(don't paste a suppression comment on faith), and follows whatever this codebase's actual
formatting/import-order conventions are.

## 4. Full audit — every existing dialog instance (2026-08-29 line numbers)

| File | Overlay/dialog line(s) | What it is | Size | Has its own X today? | In-flight guard today |
|---|---|---|---|---|---|
| `admin/prices/page.tsx` | 223 / 299 | Add/Edit Price · Delete Price confirm | md / sm | yes / no | `saving` / `deleting` |
| `admin/classes/page.tsx` | 232 / 322 | Add/Edit Class · Delete Class confirm | md / sm | yes / no | (verify) / `deleting` |
| `admin/coach-contracts/page.tsx` | 208 / 297 | Add Contract · secondary confirm | md / sm | yes / no | (verify) |
| `admin/levels/page.tsx` | 178 / 229 | Add/Edit Level · Delete Level confirm | md / sm | yes / no | (verify) |
| `admin/locations/page.tsx` | 184 / 245 | Add/Edit Location · Delete Location confirm | md / sm | yes / no | (verify) |
| `admin/private-classes/page.tsx` | 347 / 446 / 480 | Add Slot · two secondary dialogs (verify exact purpose — not fully audited by this plan) | md / sm / sm | yes / verify / verify | `slotSaving` / verify / verify |
| `admin/schedules/page.tsx` | 164 | Add Schedule (verify whether a delete/secondary dialog exists elsewhere in this file under a different pattern) | md | yes | (verify) |
| `admin/spotlights/page.tsx` | 259 / 446 | Add/Edit Spotlight · secondary confirm | md / sm | yes / no | (verify) |
| `admin/subscriptions/page.tsx` | 428 / 524 / 562 | Change Schedule · Cancel Subscription · Reactivate Subscription | md / sm / sm | yes / verify / verify | (verify each) |
| `admin/testimonials/page.tsx` | 243 / 387 | Add/Edit Testimonial · secondary confirm | md / sm | yes / no | (verify) |
| `admin/users/page.tsx` | 422 / 654 / 692 | Add/Edit User · Change Password · Delete User confirm | md / sm / sm | yes / **yes** / no | `saving` / `pwSaving` / `deleting` |
| `components/portal/AddChildModal/index.tsx` | 58 | Add Child (parent portal, not admin) | md (own CSS module) | yes | `submitting` |

**25 instances across 13 files.** Cells marked "(verify)" are real gaps in this audit,
not typos — this plan was written from a `grep` sweep plus a handful of spot-reads (the
lines cited above), not a full read of every file. **The executor must open and read each
file before migrating it** (Hard Rule 12 already requires this), confirming the exact
title/aria-label/guard-variable/X-presence for that instance against the table above and
correcting the table in this doc if it drifted, rather than silently trusting it.

`admin/users/page.tsx`'s **Change Password** dialog is the one confirmed exception to
"secondary dialogs have no X" — it's a genuine form (a password field), not a pure
confirm, so it kept its X. Preserve that distinction; don't mechanically strip the X from
every `sm`-sized dialog.

## 5. Migration steps (per file)

For each of the 13 files:

1. Import `Modal` from `../../components/ui/Modal/Modal` (path depth varies by file
   location — match the existing relative-import style each file already uses for
   `Alert`/`Button`).
2. For each dialog instance in that file: replace the
   `{x.open ? (<div overlay>...<div dialog role="dialog" ...>...) : null}` block with:
   ```tsx
   <Modal
     open={x.open}
     onClose={closeX}
     title={/* the exact h2 text/expression this instance used, e.g. dialog.id ? 'Edit Price' : 'Add Price' */}
     ariaLabel={/* only if it differs from title — most instances reuse the same string for both today */}
     size={/* 'sm' if it used styles.dialogSm, else 'md' (the default) */}
     hideCloseButton={/* true only for a confirmed-no-X confirm dialog, per §4's table */}
     disableClose={/* the file's existing in-flight guard variable — saving/deleting/submitting/etc */}
     footer={<>{/* the existing dialogFooter buttons, unchanged */}</>}
   >
     {/* the existing dialogBody content, unchanged */}
   </Modal>
   ```
3. Delete the file's own `styles.overlay`/`styles.dialog`/`styles.dialogHeader`/
   `styles.dialogTitle`/`styles.dialogClose`/`styles.dialogBody`/`styles.dialogFooter`
   JSX and the backdrop-click handler function/inline arrow — `Modal` now owns all of it.
   The page's own `closeDialog`/`closeChangeSchedule`/`closePasswordDialog`/etc. functions
   stay (they're still `onClose`'s target), just stripped of anything overlay-specific.
4. Re-run **that file's own existing test suite** before moving to the next file (§0's
   execution-order rule) — a green re-run at this granularity is the fastest signal that
   the migration preserved behavior, since `Modal`'s DOM output (roles, classes, labels)
   is designed to match today's markup exactly.

`AddChildModal/index.tsx` follows the same recipe but keep its own `AddChildModal.module.css`
for anything that ISN'T dialog-frame CSS (if it has any — verify) after removing the
`.overlay`/`.dialog*` rules that duplicate `Modal.module.css` (§5b).

### 5a. `private-classes/page.tsx`, `schedules/page.tsx`, `subscriptions/page.tsx` — read fully before migrating

These three have the least-audited dialog instances in §4 (multiple dialogs whose exact
purpose/guard this plan marks "(verify)"). Read each file in full before touching it —
don't guess a title/guard/X-presence from the table; confirm against the real source.

### 5b. CSS cleanup (`admin.module.css`, `AddChildModal.module.css`)

Once every consumer of `admin.module.css`'s `.overlay`/`.dialog`/`.dialogSm`/
`.dialogHeader`/`.dialogTitle`/`.dialogClose`/`.dialogClose:hover`/`.dialogBody`/
`.dialogFooter` (lines ~232–304 as of this writing) has been migrated to `Modal`, delete
those rules from `admin.module.css` — **grep for each class name across the whole
`frontend/` tree first** to confirm nothing outside a migrated dialog still references it
(a non-dialog reuse of `.dialogBody`'s padding rule, say, would be an easy thing to miss).
Do the same check-then-delete for `AddChildModal.module.css`'s equivalent block. If
`AddChildModal.module.css` has zero rules left afterward, delete the file entirely and
drop its now-dead import.

### 5c. `docs/design-system.md` updates

- **Components inventory**: add a `Modal` row — `app/components/ui/Modal/` —
  `{ open, onClose, title, ariaLabel?, size?, hideCloseButton?, disableClose?, children,
  footer? }` — the only dialog/overlay primitive; owns Escape-to-close and the X button;
  deliberately has no backdrop-click-to-close.
- **Anti-patterns**: add a new numbered entry (currently ends at #7) — *"Hand-rolled
  overlay/dialog markup in a page's own JSX. Import `Modal`. This is exactly how the
  sitewide 'clicking outside a dialog silently discards the form' bug happened —
  25 independent copies of the same backdrop-click handler, one of which is always the
  next one someone forgets to update."*
- **Pattern A (CRUD pages)** intro paragraph (~line 86): note that the create/edit dialog
  and the delete-confirm dialog are both `Modal` instances now, `size="md"` and
  `size="sm"` respectively.

## 6. Tests

Re-read `docs/TESTING_STRATEGY.md` before writing any of these (frontend component layer:
MSW where relevant, `userEvent.setup()` for new tests, typed fixtures, mutations-never-
throw contract, isolation rules).

### 6a. `frontend/app/components/ui/Modal/__tests__/Modal.test.tsx` — the real regression suite

This is where the actual bug fix is proven, once, at the source:

1. Renders nothing (`container` is empty / dialog role absent) when `open={false}`.
2. Renders `title`, `children`, and `footer` when `open={true}`.
3. **The core regression test**: `userEvent.setup()` clicks the overlay backdrop itself
   (the outer div, not the dialog frame — `fireEvent`/`userEvent` on the element with the
   overlay's own test-accessible target, e.g. by giving the overlay a
   `data-testid="modal-overlay"` solely for this test to target unambiguously) → `onClose`
   is **not** called. Name this test after the regression it guards, per the naming
   convention (`docs/TESTING_STRATEGY.md`'s nested-`describe` rule): `describe('backdrop
   click regression — clicking outside no longer closes the dialog (owner-reported
   2026-08-29)')`.
4. Clicking the X button calls `onClose`.
5. Pressing `Escape` (`user.keyboard('{Escape}')`) calls `onClose`.
6. `disableClose={true}`: the X button is disabled (assert via `toBeDisabled()`), and
   pressing `Escape` does **not** call `onClose`.
7. `hideCloseButton={true}`: no button with `aria-label="Close"` renders at all.
8. `ariaLabel` omitted → `role="dialog"` accessible name resolves to `title`;
   `ariaLabel` provided → it wins instead.
9. `size="sm"` applies the `dialogSm` class; default/`"md"` does not.
10. Focus: on open, `document.activeElement` moves inside the dialog frame; on close (or
    unmount), it's restored to whatever had focus before open — assert with a real
    focusable trigger element rendered alongside `Modal` in the test, not a mock.

### 6b. Representative page-level regression tests (not all 13 — proportionate coverage)

`docs/TESTING_STRATEGY.md`'s "don't test a third-party library's own behavior" principle
extends here: `Modal`'s backdrop-non-closing contract is already proven at its own
unit-test level in §6a; every consuming page doesn't need to re-prove `Modal`'s own
contract. Add exactly two page-level tests, each a `describe('backdrop click regression
(shared-modal-component-plan.md)')` nested block, tied to the real reported bug:

1. **`admin/prices/__tests__/page.test.tsx`** (already touched by the per-level-
   registration-fee PR, so this repo has a concrete recent example to extend): open the
   Add Price dialog, type into the Monthly Fee field, click the backdrop (outside the
   dialog frame) — assert the dialog is still open AND the typed value is still in the
   field (the actual owner complaint: data loss). This is the one test in the whole
   suite that most directly reproduces what the owner reported.
2. **One dialog that has no X today** (per §4 — e.g. `admin/levels/page.tsx`'s Delete
   Level confirm): open it, press `Escape` — assert it closes via `onClose` (proving
   Escape works even on a dialog with no visible X, §3b's deliberate choice).

### 6c. Every migrated page's EXISTING test suite — re-run, not rewritten

Per §5's per-file migration step: after each file is migrated, its own existing
`__tests__/page.test.tsx` should pass **unchanged** — `Modal`'s DOM output is designed to
match today's markup exactly (same classes, same roles, same aria-labels, same button
text), so no existing assertion should need to change. Confirmed by this planning
session: **no existing test in this repo asserts on the backdrop-click-closes behavior at
all** (`grep -r "overlay" **/__tests__/**` returned zero matches before this plan was
written) — so there is nothing to flip/update in any of the 13 files' existing suites,
only to re-run as a regression check. If a real existing test DOES break during
migration, that's a genuine sign the migration changed something it shouldn't have — stop
and diagnose per Hard Rule 6, don't force the test to match.

### 6d. E2E (`frontend/e2e/`)

`admin-shell.spec.ts`'s Levels CRUD round-trip is the only E2E spec that drives a real
dialog open/close. Confirmed by this planning session: it never interacts with the
backdrop, so it needs no edit — but per `CLAUDE.md`'s pre-read table, if the migration of
`admin/levels/page.tsx` changes any DOM the spec's selectors depend on (button
names/roles), update the spec in the same PR. State in the PR description whichever way
it lands (unchanged, or updated).

### 6e. Full-suite run before handing back

`TZ=UTC npm test` in `frontend/` (no backend changes in this plan, so no backend run
needed) plus `npx tsc --noEmit`. Report the pass count against the current baseline —
per `docs/TESTING_STRATEGY.md`/Hard Rule 6, do not chase an unrelated pre-existing
failure if one exists; report it and stop.

## 7. Doc close-outs (same PR)

- `docs/design-system.md` — §5c's three edits (Components inventory row, new anti-pattern
  entry, Pattern A paragraph note).
- `docs/features/admin.md` — if its Prices/Levels/etc. per-page sections describe dialog
  markup directly (they mostly describe columns/fields/guards, not JSX), no change
  expected; verify, don't assume.
- `docs/features/parent-portal.md` — verify whether it documents `AddChildModal`'s own
  overlay-click behavior anywhere; update if so.
- `CLAUDE.md` Documentation Map — flip this plan's row to BUILT/pending-review with the
  date, same convention as `docs/plans/per-level-registration-fee-plan.md`'s row.
- This file — append a completion-notes section (what was built, the real per-instance
  title/size/hideCloseButton/disableClose values discovered while migrating each of the
  13 files, replacing every "(verify)" cell in §4's table with the confirmed answer, and
  any real gap found mid-build).

## 8. Rollout

None needed beyond the PR merge — this is a pure frontend refactor with no backend
change, no data migration, and no admin-configurable setting. Once merged and deployed,
every dialog sitewide behaves the same way: `X`, `Esc`, or its own `Cancel` button are the
only ways to close it — a misclick outside the box no longer discards anything.

---

## Completion notes (2026-08-29)

Built exactly as designed. `Modal` (`app/components/ui/Modal/Modal.tsx` +
`Modal.module.css`, CSS ported verbatim from `admin.module.css`'s old dialog rules) with
the exact `ModalProps` API in §3a — `disableClose`/`hideCloseButton` implemented via refs
inside the `Escape`-listener effect (not the sketch's `eslint-disable` — no suppression
comment needed; verified no lint config even exists in this repo, so it was moot either
way). All 13 files/25 instances migrated; `AddChildModal.module.css` was fully dead
afterward (only dialog-frame rules) and deleted entirely rather than left empty.

**§4's audit table, every "(verify)" cell resolved during migration** (no surprises —
every file matched the two established shapes: full CRUD dialog with an X, confirm
dialog without one):

| File | In-flight guard(s) | Notes |
|---|---|---|
| `prices` | `saving` / `deleting` | as documented |
| `classes` | `saving` / `deleting` | as documented |
| `coach-contracts` | `saving` / `deactivating` | secondary dialog is "Deactivate Contract" (not a generic delete) |
| `levels` | `saving` / `deleting` | as documented |
| `locations` | `saving` / `deleting` | as documented |
| `private-classes` | `slotSaving` / `cancelling` / `deleting` | 3 dialogs: Add Slot, Cancel Enrollment, Delete Slot. This file's own lucide `X` import survived — it's also used as a plain row-action icon (delete-slot button), unrelated to any dialog's close button |
| `schedules` | `saving` | confirmed only ONE dialog exists in this file — no delete/secondary dialog at all (the page's own footer note: "Schedules can't be edited once created") |
| `spotlights` | `saving \|\| uploadingImage` / `deleting` | as documented |
| `subscriptions` | `changeDialog.saving` / `cancelDialog.saving` / `reactivateDialog.saving` | 3 dialogs: Change Schedule (2-step, X present), Cancel Subscription (no X), Reactivate Subscription (no X) — all confirmed against source, not assumed |
| `testimonials` | `saving \|\| uploadingImage` / `deleting` | as documented |
| `users` | `saving` / `pwSaving` / `deleting` | 3 dialogs: Add/Edit User, **Change Password (confirmed the one exception — has an X)**, Delete User |
| `AddChildModal` | `submitting` | single dialog, always `open` (parent conditionally mounts the component itself) |

**Real subtlety found mid-build, not anticipated in the plan**: `admin.module.css`'s
`.overlay` class is **also** used by `admin/layout.tsx`'s mobile off-canvas sidebar
backdrop — a completely different UI element that happens to share the class name. The
plan's §5b said to grep-verify before deleting; that grep caught it. Only the
dialog-specific rules (`.dialog`/`.dialogSm`/`.dialogHeader`/`.dialogTitle`/
`.dialogClose`/`.dialogClose:hover`/`.dialogBody`/`.dialogFooter`) were deleted from
`admin.module.css` — `.overlay` (and its `.overlayVisible` companion) stayed, with a new
comment explaining the coincidental name-sharing (CSS Modules scope per-file, so there
was never an actual collision with `Modal`'s own separate `.overlay`).

Several dialogs' bodies directly accessed a nullable target's properties
(`deleteTarget.name`, `changeDialog.subscription.scheduleId...`, etc.) relying on the old
`{x ? (<dialog/>) : null}` wrapper to guarantee non-null. Since `Modal`'s children are
now evaluated by the parent regardless of its own `open` prop, every such access was
updated to optional chaining or an inline null-guard (`subscriptions.tsx`'s Change
Schedule dialog needed the most care — its body branches on both `subscription` being
non-null AND `step`).

**Tests — all run, nothing broken, new coverage added:**
- `Modal.test.tsx` (new): 13/13 — nothing-when-closed, renders title/body/footer, the
  named backdrop-click regression block (backdrop click and inner-content click both do
  NOT call `onClose`), X closes, Escape closes, `disableClose` blocks both X and Escape,
  `hideCloseButton` hides X but Escape still works, `ariaLabel` fallback/override, `size`
  class selection, and focus capture/restore against a real rendered trigger button.
- Every one of the 13 migrated files' **existing** test suites re-run immediately after
  its own migration (per §0's execution-order rule) — all passed unchanged, confirming
  `Modal`'s DOM output matches the old hand-rolled markup exactly (same roles, classes,
  aria-labels, button text).
- `prices/__tests__/page.test.tsx` gained the one representative page-level regression
  test from §6b (backdrop click, typed Monthly Fee value survives). The plan's second
  suggested case (Escape on an X-less dialog) is already covered generically by
  `Modal.test.tsx`'s own `hideCloseButton` test — not duplicated at the page level, per
  the "don't re-prove a library's own contract" principle §6b itself invokes.
- E2E: ran the full suite (not just the admin-shell spec) — **19 passed, 2 skipped**
  (the pre-existing, already-documented visual-baseline skips, unrelated to this change).
  `admin-shell.spec.ts`'s Levels CRUD round-trip and its accessibility scan both passed
  with no new violations — confirming `Modal`'s added `aria-modal`/focus-management
  didn't regress anything axe-core checks.
- Full-suite run: **frontend 322/322** (backend untouched by this plan — no backend run
  needed, no backend file changed), `npx tsc --noEmit` clean.

**Docs closed out**: `docs/design-system.md` (Components inventory row, anti-pattern #8,
Pattern A CRUD paragraph), `docs/features/parent-portal.md` (the `AddChildModal` section
explicitly said "backdrop-click" closes it — corrected), `docs/TEST_COVERAGE.md`
(Improvement Plan #4, the focus-trapping gap). `docs/features/admin.md` had no
backdrop-click language to correct (verified, not assumed).

**Not done, by design (per Hard Rules):** nothing has been committed. The branch
`feature/shared-modal-component` exists locally with the working-tree changes only,
staged for the owner to test locally first (Hard Rule 5) before any commit.
