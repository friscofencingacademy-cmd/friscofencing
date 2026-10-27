// The step loop for a live gate (docs/plans/playwright-live-gates-plan.md D2).
//
// A gate script declares its steps with step(n, do, expect, fn). The runner
// narrates each one before running it, runs it, and prints what was seen:
//
//   Step 3/9 — Click Charge on that row. Expect: The Charge dialog opens.
//     Seen: "Charge Subscription · Audit BridgeSecond …" — pass
//
// A step function returns the exact text it read from the page (a pass) or
// throws StepFailure(seen) (a fail). It may return skipped(reason) only where
// its gate .md says the step can be skipped. g.skip[n] = reason set by an
// earlier step skips step n too.
//
// The run stops at the first failing step; later steps never run. A step is
// retried once, and only once, when its first attempt hit a Playwright
// TimeoutError (a page that had not finished loading). Any write the write
// guard blocked during a step fails that step, whatever the step returned.

class StepFailure extends Error {
  constructor(seen) {
    super(seen);
    this.name = 'StepFailure';
    this.seen = seen;
  }
}

const SKIPPED = Symbol('skipped');

function skipped(reason) {
  return { [SKIPPED]: true, reason };
}

function step(n, doText, expectText, fn) {
  return { n, do: doText, expect: expectText, fn };
}

// Throws StepFailure(seen) unless `condition` holds; returns `seen` otherwise.
function expectThat(condition, seen) {
  if (!condition) throw new StepFailure(seen);
  return seen;
}

function isLoadTimeout(error) {
  return Boolean(error) && error.name === 'TimeoutError';
}

async function attempt(stepDef, g) {
  try {
    const value = await stepDef.fn(g);
    if (value && value[SKIPPED]) return { result: 'skipped', seen: value.reason };
    return { result: 'pass', seen: value == null ? '' : String(value) };
  } catch (error) {
    return { result: 'fail', seen: error instanceof StepFailure ? error.seen : error.message, error };
  }
}

// Runs `steps` against `g` and returns one row per step that ran:
// { n, expect, seen, result: 'pass' | 'fail' | 'skipped' }.
// `takeBlocked` returns the write-guard reasons since its last call.
async function runSteps(steps, g, { log = console.log, takeBlocked = () => [] } = {}) {
  const rows = [];
  const total = steps.length;
  g.skip = g.skip || {};

  for (const stepDef of steps) {
    log(`Step ${stepDef.n}/${total} — ${stepDef.do} Expect: ${stepDef.expect}`);

    let outcome;
    if (g.skip[stepDef.n]) {
      outcome = { result: 'skipped', seen: g.skip[stepDef.n] };
    } else {
      // eslint-disable-next-line no-await-in-loop -- steps run in order by design.
      outcome = await attempt(stepDef, g);
      if (outcome.result === 'fail' && isLoadTimeout(outcome.error)) {
        log('  (page had not finished loading — one retry)');
        takeBlocked();
        // eslint-disable-next-line no-await-in-loop
        outcome = await attempt(stepDef, g);
      }
    }

    const blocked = takeBlocked();
    if (blocked.length > 0) {
      outcome = { result: 'fail', seen: blocked.join('; ') };
    }

    log(`  Seen: "${outcome.seen}" — ${outcome.result}`);
    rows.push({ n: stepDef.n, expect: stepDef.expect, seen: outcome.seen, result: outcome.result });

    if (outcome.result === 'fail') break;
  }

  return rows;
}

module.exports = { StepFailure, expectThat, runSteps, skipped, step };
