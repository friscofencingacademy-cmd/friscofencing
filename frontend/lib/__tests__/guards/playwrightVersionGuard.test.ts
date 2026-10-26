import fs from 'fs';
import path from 'path';

// Static guard: three Playwright versions must always be the same.
//  - @playwright/test   the test runner
//  - playwright-core    pinned at the top level so @axe-core/playwright's peer
//                       dependency resolves to the runner's copy — before it was
//                       pinned, npm installed a second, newer playwright-core and
//                       the accessibility scans ran on it (caught by type-checking
//                       e2e/, docs/plans/testing-strategy-refresh-plan.md PR A)
//  - the CI e2e image   mcr.microsoft.com/playwright:v<version>-jammy, whose
//                       browsers must match the runner (and screenshot baselines
//                       are only valid when generated in that image)

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(FRONTEND_ROOT, 'package.json'), 'utf8'));
const ci = fs.readFileSync(path.join(FRONTEND_ROOT, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

describe('Playwright version guard', () => {
  const runner = pkg.devDependencies['@playwright/test'];

  it('pins @playwright/test to an exact version', () => {
    expect(runner).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('pins playwright-core to the same exact version', () => {
    expect(pkg.devDependencies['playwright-core']).toBe(runner);
  });

  it('runs CI E2E in the Playwright image of the same version', () => {
    const tags = [...ci.matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)-/g)].map((match) => match[1]);
    expect(tags.length).toBeGreaterThan(0);
    tags.forEach((tag) => expect(tag).toBe(runner));
  });
});
