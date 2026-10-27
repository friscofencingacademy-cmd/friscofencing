const test = require('node:test');
const assert = require('node:assert/strict');

const { StepFailure, expectThat, runSteps, skipped, step } = require('../lib/gate-runner');

function collect() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

test('a passing step prints the narration and what was seen', async () => {
  const { lines, log } = collect();
  const rows = await runSteps([step(1, 'Open the page.', 'It loads.', async () => 'Subscriptions · 25 total')], {}, { log });

  assert.deepEqual(lines, ['Step 1/1 — Open the page. Expect: It loads.', '  Seen: "Subscriptions · 25 total" — pass']);
  assert.deepEqual(rows, [{ n: 1, expect: 'It loads.', seen: 'Subscriptions · 25 total', result: 'pass' }]);
});

test('a failing step stops the run; later steps never run', async () => {
  let ranThird = false;
  const rows = await runSteps(
    [
      step(1, 'a', 'x', async () => 'ok'),
      step(2, 'b', 'y', async () => expectThat(false, 'Total: $22.50')),
      step(3, 'c', 'z', async () => {
        ranThird = true;
        return 'ok';
      }),
    ],
    {},
    { log: () => {} }
  );

  assert.equal(ranThird, false);
  assert.deepEqual(rows.map((row) => [row.n, row.result, row.seen]), [
    [1, 'pass', 'ok'],
    [2, 'fail', 'Total: $22.50'],
  ]);
});

test('an unexpected error fails the step with its message', async () => {
  const rows = await runSteps([step(1, 'a', 'x', async () => { throw new Error('boom'); })], {}, { log: () => {} });
  assert.deepEqual([rows[0].result, rows[0].seen], ['fail', 'boom']);
});

test('a skipped step is recorded with its reason and the run continues', async () => {
  const g = {};
  const rows = await runSteps(
    [
      step(1, 'a', 'x', async (ctx) => {
        ctx.skip[3] = 'No this-month date';
        return skipped('Nothing to check');
      }),
      step(2, 'b', 'y', async () => 'ok'),
      step(3, 'c', 'z', async () => 'should not run'),
    ],
    g,
    { log: () => {} }
  );

  assert.deepEqual(rows.map((row) => [row.n, row.result, row.seen]), [
    [1, 'skipped', 'Nothing to check'],
    [2, 'pass', 'ok'],
    [3, 'skipped', 'No this-month date'],
  ]);
});

test('retries once, only after a load timeout', async () => {
  let attempts = 0;
  const timeout = () => {
    const error = new Error('locator.waitFor: Timeout 15000ms exceeded');
    error.name = 'TimeoutError';
    return error;
  };

  const retried = await runSteps(
    [step(1, 'a', 'x', async () => { attempts += 1; if (attempts === 1) throw timeout(); return 'loaded'; })],
    {},
    { log: () => {} }
  );
  assert.equal(attempts, 2);
  assert.equal(retried[0].result, 'pass');

  let twice = 0;
  const failedTwice = await runSteps([step(1, 'a', 'x', async () => { twice += 1; throw timeout(); })], {}, { log: () => {} });
  assert.equal(twice, 2);
  assert.equal(failedTwice[0].result, 'fail');

  let once = 0;
  await runSteps([step(1, 'a', 'x', async () => { once += 1; throw new StepFailure('wrong amount'); })], {}, { log: () => {} });
  assert.equal(once, 1);
});

test('a write blocked during a step fails it, whatever the step returned', async () => {
  let blocked = ['Blocked write: POST /api/v1/subscriptions/abc/charge'];
  const takeBlocked = () => {
    const taken = blocked;
    blocked = [];
    return taken;
  };
  const rows = await runSteps(
    [step(1, 'a', 'x', async () => 'looked fine'), step(2, 'b', 'y', async () => 'never')],
    {},
    { log: () => {}, takeBlocked }
  );

  assert.deepEqual(rows, [{ n: 1, expect: 'x', seen: 'Blocked write: POST /api/v1/subscriptions/abc/charge', result: 'fail' }]);
});
