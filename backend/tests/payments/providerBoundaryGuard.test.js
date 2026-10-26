// Static guard — the payment provider port's boundary
// (docs/decisions/013-payment-provider-port.md, payment-provider-port-plan.md
// D10/§5.1.10). Copied from CKQ's providerBoundaryGuard.test.js (ADR
// backend-021), extended to scripts/ and tests/. This repo has no ESLint, so
// this Jest test IS the gate.
//
// Rules, over backend/src, backend/scripts and backend/tests:
//   1. Only an adapter (src/payments/<provider>/) and its SDK bootstrap
//      (src/config/<provider>.js) may require a provider SDK or bootstrap.
//   2. Nothing outside src/payments/ may require an adapter file directly —
//      business code goes through getPaymentProvider().
//   3. Nothing outside an adapter may inspect a provider's error shape.
// Test code may reach a provider only through tests/testUtils/payments.js and
// tests/payments/** (the adapter suites).

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const ROOTS = ['src', 'scripts', 'tests'];

// Forward-slash paths relative to backend/ — a raw-path regex silently fails
// on Windows backslashes.
const ADAPTER_DIRS = ['src/payments/stripe/'];
const SDK_BOOTSTRAPS = ['src/config/stripe.js'];
const TEST_PROVIDER_ACCESS = ['tests/testUtils/payments.js', 'tests/payments/'];

// Files allowed to break a rule until a named PR migrates them. Must stay empty.
const ALLOWLIST = [];

const SDK_REQUIRE = [/require\(\s*['"]stripe['"]\s*\)/, /require\([^)]*config\/stripe['"]\s*\)/];
const ADAPTER_REQUIRE = /require\([^)]*payments\/(stripe|square)\/[^)]*\)/;
const ERROR_SNIFF = [/\.type\s*===\s*['"]Stripe/, /StripeCardError/];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|cjs|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(BACKEND, file).split(path.sep).join('/');
const startsWithAny = (rel, prefixes) => prefixes.some((prefix) => rel === prefix || rel.startsWith(prefix));

const SELF = 'tests/payments/providerBoundaryGuard.test.js';
const files = ROOTS.flatMap((root) => walk(path.join(BACKEND, root)))
  .map((file) => ({ rel: relative(file), content: fs.readFileSync(file, 'utf8') }))
  .filter(({ rel }) => rel !== SELF);

function offenders(test, exempt) {
  return files.filter(({ rel, content }) => !exempt(rel) && !ALLOWLIST.includes(rel) && test(content)).map(({ rel }) => rel);
}

describe('payment provider boundary guard', () => {
  it('scans the backend (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files.some(({ rel }) => rel === 'src/payments/stripe/stripe.provider.js')).toBe(true);
  });

  it('only adapters, their SDK bootstraps and the test-access helpers require a provider SDK', () => {
    const exempt = (rel) =>
      startsWithAny(rel, ADAPTER_DIRS) || SDK_BOOTSTRAPS.includes(rel) || startsWithAny(rel, TEST_PROVIDER_ACCESS);

    expect(offenders((content) => SDK_REQUIRE.some((re) => re.test(content)), exempt)).toEqual([]);
  });

  it('nothing outside src/payments/ requires an adapter directly', () => {
    const exempt = (rel) => rel.startsWith('src/payments/') || startsWithAny(rel, TEST_PROVIDER_ACCESS);

    expect(offenders((content) => ADAPTER_REQUIRE.test(content), exempt)).toEqual([]);
  });

  it('nothing outside an adapter inspects a provider error shape', () => {
    const exempt = (rel) => startsWithAny(rel, ADAPTER_DIRS) || startsWithAny(rel, TEST_PROVIDER_ACCESS);

    expect(offenders((content) => ERROR_SNIFF.some((re) => re.test(content)), exempt)).toEqual([]);
  });

  it('has an empty allowlist', () => {
    expect(ALLOWLIST).toEqual([]);
  });

  it('every exempt path exists (no stale exemptions)', () => {
    for (const rel of [...ADAPTER_DIRS, ...SDK_BOOTSTRAPS, ...TEST_PROVIDER_ACCESS]) {
      expect(fs.existsSync(path.join(BACKEND, rel))).toBe(true);
    }
  });
});
