const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { lookUpCommit, renderResult, resultPath } = require('../lib/gate-result');

const FIELDS = {
  gate: 'f15-prorated-top-payer',
  result: 'pass',
  env: 'staging',
  url: 'https://friscofencing-git-develop-frisco-fencing.vercel.app',
  commit: '21465fb',
  date: '2026-10-27',
  runBy: 'Playwright (npm run gate), watched by the owner',
  recording: 'audit/gate-runs/2026-10-27-f15-prorated-top-payer/f15-prorated-top-payer-admin.webm',
  rows: [
    { n: 'P1', expect: 'Both active', seen: 'active; active', result: 'pass' },
    { n: 1, expect: 'Table loads', seen: 'a | b', result: 'pass' },
    { n: 2, expect: 'No this-month date', seen: 'None left', result: 'skipped' },
  ],
  notes: ['Confirm Charge was never clicked.'],
};

test("matches the README's result format exactly", () => {
  assert.equal(
    renderResult(FIELDS),
    [
      '---',
      'gate: f15-prorated-top-payer',
      'result: pass',
      'env: staging',
      'url: https://friscofencing-git-develop-frisco-fencing.vercel.app',
      'commit: 21465fb',
      'date: 2026-10-27',
      'run_by: Playwright (npm run gate), watched by the owner',
      'recording: audit/gate-runs/2026-10-27-f15-prorated-top-payer/f15-prorated-top-payer-admin.webm',
      '---',
      '',
      '| # | Expect | Seen | Result |',
      '|---|---|---|---|',
      '| P1 | Both active | active; active | pass |',
      '| 1 | Table loads | a \\| b | pass |',
      '| 2 | No this-month date | None left | skipped |',
      '',
      'Notes:',
      '- Confirm Charge was never clicked.',
      '',
    ].join('\n')
  );
});

test('never writes a password, wherever a step quoted it', () => {
  const secret = 'S3cret-Pass!';
  const out = renderResult({
    ...FIELDS,
    rows: [{ n: 1, expect: 'x', seen: `typed ${secret} into the field`, result: 'fail' }],
    notes: [`note with ${secret}`],
    secrets: [secret, undefined, ''],
  });
  assert.equal(out.includes(secret), false);
  assert.match(out, /typed \[redacted\] into the field/);
});

test('adds -2, -3 when a result file for the day exists', () => {
  const dir = path.join('docs', 'live-gates', 'results');
  const taken = new Set([path.join(dir, '2026-10-27-x.md'), path.join(dir, '2026-10-27-x-2.md')]);
  assert.equal(resultPath(dir, '2026-10-27', 'x', (file) => taken.has(file)), path.join(dir, '2026-10-27-x-3.md'));
  assert.equal(resultPath(dir, '2026-10-28', 'x', (file) => taken.has(file)), path.join(dir, '2026-10-28-x.md'));
});

const SHA = '1e70067aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function gh(statuses) {
  return (args) => (args[1].endsWith('/commits/develop') ? `${SHA}\n` : JSON.stringify(statuses));
}

test('the commit is develop’s head only when both Vercel deployments succeeded', () => {
  const green = [
    { context: 'Vercel – friscofencing', state: 'success' },
    { context: 'Vercel – friscofencing-backend', state: 'success' },
  ];
  assert.equal(lookUpCommit(gh(green)), '1e70067');
  assert.equal(lookUpCommit(gh([green[0], { context: 'Vercel – friscofencing-backend', state: 'pending' }])), 'unknown');
  assert.equal(lookUpCommit(gh([green[0]])), 'unknown');
});

test('the commit is unknown when gh is missing or fails', () => {
  assert.equal(
    lookUpCommit(() => {
      throw new Error('gh: command not found');
    }),
    'unknown'
  );
  assert.equal(lookUpCommit(() => 'not a sha'), 'unknown');
});
