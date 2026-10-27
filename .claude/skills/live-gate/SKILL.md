---
name: live-gate
description: Run a feature's live gate (docs/live-gates/<id>.md) on staging with its Playwright script (audit/gates/<id>.js) in a visible window while the owner watches, relay the step-by-step narration, and report the result file the script writes. A feature cannot be promoted to main without a passing live gate.
disable-model-invocation: true
---

# /live-gate — watched run of one feature's gate

Usage: `/live-gate <gate-id>` (e.g. `/live-gate f15-prorated-top-payer`). With no argument, list
the gates in `docs/live-gates/` and, for each, its latest file in `docs/live-gates/results/`;
then stop.

Format, rules and the promotion rule: `docs/live-gates/README.md`. Design:
`docs/plans/playwright-live-gates-plan.md`. The script does the work; this skill runs it and
reports. Claude never drives a browser for a gate and never types a password.

---

## 1. Check before running

1. Read `docs/live-gates/<gate-id>.md`. If `audit/gates/<gate-id>.js` does not exist, stop and say
   the gate has no script yet.
2. If the gate's frontmatter says `mutates: true`, list what the steps will save or charge and
   run with `--allow-writes` only if the owner's invoking message allowed writes
   (e.g. `/live-gate <id> allow writes`). Otherwise ask once and wait.
3. `env` other than `staging` is refused by the runner; do not try to work around it.

## 2. Run it

Run in the foreground, from `audit/`, with a long timeout (up to 10 minutes):

```bash
cd audit && npm run gate -- <gate-id> --headed
```

Add `--allow-writes` only per section 1. A Chromium window opens on the owner's screen; the
script signs in from `audit/.env`, checks the preconditions, and walks every step, printing
`Step n/N — <Do> Expect: <Expect>` and `Seen: "<text>" — pass|fail` as it goes.

If the run fails to start because Chromium is missing, tell the owner to run
`cd audit && npx playwright install chromium` and stop.

## 3. Report

The exit code is the verdict: `0` pass, `1` fail, `2` blocked (a precondition does not hold —
the result file says which), `3` refused (unknown id, production URL, missing env, `mutates`
without `--allow-writes`; the message says which).

Finish in chat with:
- the overall result;
- a table of the preconditions and steps (#, result, what was seen), from the printed output;
- the result file path (`docs/live-gates/results/<date>-<id>.md`) and the run folder
  (`audit/gate-runs/<date>-<id>/`, holding the video and trace);
- for a fail, the step it stopped at, what was seen, and the failure screenshot path. Do not
  change app code or data to make a gate pass.

Do not commit; committing follows the CLAUDE.md rules.
