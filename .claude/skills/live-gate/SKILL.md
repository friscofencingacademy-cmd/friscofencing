---
name: live-gate
description: Walk a feature's live gate (docs/live-gates/<id>.md) step by step in the owner's own Chrome on staging, narrating each check while the owner watches, recording a GIF, and writing a pass/fail result file. A feature cannot be promoted to main without a passing live gate.
disable-model-invocation: true
---

# /live-gate — watched browser check of one feature

Usage: `/live-gate <gate-id>` (e.g. `/live-gate f15-prorated-top-payer`). With no argument,
list the gates in `docs/live-gates/` and, for each, its latest result file; then stop.

Format, rules and the promotion rule: `docs/live-gates/README.md`. Read it first.

The owner is watching. **Narrate every step in chat before doing it**, one short line:
`Step 3/9 — Click Charge on BridgeSecond's row. Expect: the dialog opens.` After it, one line
with what was seen and `pass` / `fail`.

---

## 1. Load the gate

1. Read `docs/live-gates/<gate-id>.md` in full, and the plan it names (the relevant section).
2. If `env` is `production`, stop unless the owner's message that invoked this skill says
   production explicitly.
3. If `mutates: true`, list exactly what the steps will save, charge or delete, and continue only
   if the owner's invoking message allowed writes (e.g. `/live-gate <id> allow writes`).
   Otherwise ask once and wait.

## 2. Preconditions (read-only)

Check every precondition the gate lists. Database checks are read-only queries against staging
(`backend/.env`'s `AUDIT_MONGO_URI`; confirm the database name is `friscofencing-staging`
before reading). Compute any expected amounts now and show the arithmetic in chat.

Record which `develop` commit staging serves:
`gh api repos/friscofencingacademy-cmd/friscofencing/commits/develop --jq .sha` gives the branch
head. Note it as the commit only if the Vercel deployment for it is complete (check the commit's
status: `gh api repos/friscofencingacademy-cmd/friscofencing/commits/<sha>/status --jq '.statuses[] | "\(.context) \(.state)"'`); otherwise record `unknown`.

A precondition that fails makes the run `blocked`: write the result file (section 5) and stop.

## 3. Open the browser

1. Load the browser tools in ONE call:
   `ToolSearch select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__gif_creator,mcp__claude-in-chrome__read_console_messages`
2. `tabs_context_mcp` first, then open a **new** tab (never reuse the owner's tabs). If it reports
   the extension is not connected and `list_connected_browsers` returns none, the run is
   `blocked`: tell the owner to open Chrome with the Claude extension installed and signed in to
   the same claude.ai account as Claude Code (restart Chrome after a first install), write the
   result file, and stop. If several browsers are connected and none is selected, ask the owner
   which one to use.
3. Navigate to the staging URL (`audit/.env`'s `AUDIT_STAGING_URL`, default
   `https://friscofencing-git-develop-frisco-fencing.vercel.app`). Refuse any URL that is the bare
   production host.
4. Log in as the gate's `login`. If the tab is already logged in as that role, keep it. Passwords
   come from `audit/.env` (`AUDIT_SUPERADMIN_*`, `AUDIT_TEST_PASSWORD`) or are typed by the owner;
   never echo a password in chat or write it to any file.
5. Start the GIF recording, and capture a couple of frames before the first step.

## 4. Walk the steps

For each row of the gate's Steps table, in order:
1. Narrate: `Step n/N — <Do>. Expect: <Expect>.`
2. Act through the browser tools, by visible label (`find` the element, then click or type).
3. Verify by **reading the page** (`get_page_text`, `find`, or a screenshot) — never assume a click
   worked. Quote the exact text or amount seen.
4. Report `Seen: <quote> — pass` or `— fail`.

Rules while walking:
- **Never confirm a charge, save, delete or submit** unless the gate's step says to and writes
  were allowed in section 1.
- **Do not trigger browser dialogs** (`alert`/`confirm`); they freeze the extension. If a step
  needs one, stop and tell the owner.
- **On a fail, stop.** Take a screenshot, read the console for errors, and do not change app code
  or data to make it pass. One retry is allowed only for a page that had not finished loading.
- If the browser tools stop responding after 2–3 attempts, stop and tell the owner; the run is
  `blocked`.

## 5. Record the result

1. Capture a couple of frames after the last step, stop the GIF and save it as
   `<YYYY-MM-DD>-<gate-id>.gif` (Central date).
2. Write `docs/live-gates/results/<YYYY-MM-DD>-<gate-id>.md` in the README's result format: one
   table row per step with the Expect, the exact text seen, and the result. If a file with that
   name exists, add `-2`, `-3`. Never edit an earlier result file.
3. Close the tab you opened.
4. Finish in chat with: the overall result, a table of the steps (#, result, what was seen), the
   GIF file name, and the result file path. Do not commit; committing follows the CLAUDE.md
   rules.
