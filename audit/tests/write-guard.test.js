const test = require('node:test');
const assert = require('node:assert/strict');

const { checkRequest, installWriteGuard } = require('../lib/write-guard');

const BASE = 'https://friscofencing-git-develop-frisco-fencing.vercel.app';

test('blocks POST, PUT, PATCH and DELETE to the app API, naming method and path', () => {
  assert.deepEqual(checkRequest('POST', `${BASE}/api/v1/subscriptions/abc/charge`), {
    allowed: false,
    reason: 'Blocked write: POST /api/v1/subscriptions/abc/charge',
  });
  assert.equal(checkRequest('PUT', `${BASE}/api/v1/users/1/password`).allowed, false);
  assert.equal(checkRequest('patch', `${BASE}/api/v1/settings`).reason, 'Blocked write: PATCH /api/v1/settings');
  assert.equal(checkRequest('DELETE', `${BASE}/api/v1/levels/1`).allowed, false);
  assert.equal(checkRequest('POST', `${BASE}/api/v1/registrations`).allowed, false);
});

test('allows GET, HEAD, sign-in and sign-out', () => {
  assert.equal(checkRequest('GET', `${BASE}/api/v1/subscriptions?q=x`).allowed, true);
  assert.equal(checkRequest('HEAD', `${BASE}/api/v1/auth/me`).allowed, true);
  assert.equal(checkRequest('POST', `${BASE}/api/v1/auth/login`).allowed, true);
  assert.equal(checkRequest('POST', `${BASE}/api/v1/auth/logout`).allowed, true);
  assert.equal(checkRequest('POST', `${BASE}/api/v1/auth/register`).allowed, false);
});

test('leaves non-API URLs alone (Stripe, Next.js assets)', () => {
  assert.equal(checkRequest('POST', 'https://api.stripe.com/v1/payment_methods').allowed, true);
  assert.equal(checkRequest('POST', `${BASE}/_next/data/x.json`).allowed, true);
});

function fakeRoute(method, url) {
  const calls = [];
  return {
    calls,
    request: () => ({ method: () => method, url: () => url }),
    continue: async () => calls.push('continue'),
    abort: async (code) => calls.push(`abort:${code}`),
  };
}

test('installs on the context and aborts a blocked write, reporting it once', async () => {
  let handler;
  const context = { route: async (pattern, fn) => { assert.equal(pattern, '**/api/v1/**'); handler = fn; } };
  const guard = await installWriteGuard(context);

  const write = fakeRoute('POST', `${BASE}/api/v1/subscriptions/abc/record-payment`);
  await handler(write);
  const read = fakeRoute('GET', `${BASE}/api/v1/subscriptions`);
  await handler(read);

  assert.deepEqual(write.calls, ['abort:blockedbyclient']);
  assert.deepEqual(read.calls, ['continue']);
  assert.deepEqual(guard.takeBlocked(), ['Blocked write: POST /api/v1/subscriptions/abc/record-payment']);
  assert.deepEqual(guard.takeBlocked(), []);
});

test('--allow-writes lets a write through', async () => {
  let handler;
  const guard = await installWriteGuard({ route: async (pattern, fn) => { handler = fn; } }, { allowWrites: true });
  const write = fakeRoute('POST', `${BASE}/api/v1/registrations`);
  await handler(write);
  assert.deepEqual(write.calls, ['continue']);
  assert.deepEqual(guard.takeBlocked(), []);
});
