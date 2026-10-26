import fs from 'fs';
import path from 'path';

// Static guard — an E2E spec arms a network wait BEFORE the action that
// triggers the request (`const p = page.waitForResponse(…)`, act, `await p`),
// and drives polls with `page.clock`, never a synthetic `visibilitychange`
// (docs/plans/testing-strategy-refresh-plan.md PR C; CKQ rule 6). A directly
// awaited waitForResponse/waitForRequest is armed after the trigger and can
// miss a fast response forever; a dispatched `visibilitychange` does not
// change `document.visibilityState`, so a page gating on it may never fetch.
// Ported from CKQ's e2eWaitOrderGuard.test.ts. No allowlist.

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const E2E_DIR = path.join(FRONTEND_ROOT, 'e2e');

const AWAITED_WAIT = /\bawait\s+page\.(?:waitForResponse|waitForRequest)\(/;
const VISIBILITY_DISPATCH = /dispatchEvent\(\s*new\s+Event\(\s*["'`]visibilitychange["'`]/;

function findViolations(source: string): number[] {
  const lines: number[] = [];
  source.split(/\r?\n/).forEach((text, i) => {
    if (AWAITED_WAIT.test(text) || VISIBILITY_DISPATCH.test(text)) lines.push(i + 1);
  });
  return lines;
}

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('E2E wait-order / synthetic visibilitychange guard', () => {
  const files = listTsFiles(E2E_DIR);

  it('scans e2e/ (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('no e2e file awaits a network wait directly or dispatches a synthetic visibilitychange', () => {
    const offenders = files.flatMap((file) => {
      const rel = path.relative(FRONTEND_ROOT, file).split(path.sep).join('/');
      return findViolations(fs.readFileSync(file, 'utf8')).map((line) => `${rel}:${line}`);
    });

    expect(offenders).toEqual([]);
  });

  describe('findViolations', () => {
    it('flags a directly awaited waitForResponse or waitForRequest', () => {
      expect(findViolations('await page.waitForResponse((res) => res.ok());')).toEqual([1]);
      expect(findViolations("const req = await page.waitForRequest('**/api/v1/levels');")).toEqual([1]);
    });

    it('does not flag a wait armed first and awaited after the action', () => {
      const source = "const saved = page.waitForResponse('**/api/v1/levels');\nawait button.click();\nawait saved;";
      expect(findViolations(source)).toEqual([]);
    });

    it('flags a synthetic visibilitychange dispatch', () => {
      expect(findViolations("await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));")).toEqual([1]);
    });

    it('does not flag page.clock', () => {
      expect(findViolations('await page.clock.fastForward(30_000);')).toEqual([]);
    });
  });
});
