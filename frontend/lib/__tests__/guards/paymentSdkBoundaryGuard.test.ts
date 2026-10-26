import fs from 'fs';
import path from 'path';

// Static guard — the frontend half of the payment provider boundary
// (docs/decisions/013-payment-provider-port.md, payment-provider-port-plan.md
// D10). Only app/components/payment/ may load or call a payment provider's
// browser SDK; pages render <PaymentMethodCollector> and know nothing else.
// This repo has no ESLint, so this test IS the gate (CKQ enforces the same
// boundary with no-restricted-imports).
//
// Production code only: a test may stub an SDK with jest.mock (the documented
// external-SDK exception in docs/TESTING_STRATEGY.md), so __tests__ is exempt.

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_ROOTS = ['app', 'lib'];
const BOUNDARY = 'app/components/payment/';

const PROVIDER_SDK = [
  /from\s+['"]@stripe\//,
  /(?:require|import)\(\s*['"]@stripe\//,
  /squarecdn\.com/,
  /window\.Square\b/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const relative = (file: string) => path.relative(FRONTEND_ROOT, file).split(path.sep).join('/');
const files = SCAN_ROOTS.flatMap((root) => walk(path.join(FRONTEND_ROOT, root))).map((file) => ({
  rel: relative(file),
  content: fs.readFileSync(file, 'utf8'),
}));
const usesProviderSdk = (content: string) => PROVIDER_SDK.some((pattern) => pattern.test(content));

describe('payment SDK boundary guard', () => {
  it('scans the app (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no file outside app/components/payment/ loads or calls a payment provider SDK', () => {
    const offenders = files.filter(({ rel, content }) => !rel.startsWith(BOUNDARY) && usesProviderSdk(content)).map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it('the boundary folder is where the SDK actually lives (the guard is looking at the right thing)', () => {
    expect(files.some(({ rel, content }) => rel.startsWith(BOUNDARY) && usesProviderSdk(content))).toBe(true);
  });
});
