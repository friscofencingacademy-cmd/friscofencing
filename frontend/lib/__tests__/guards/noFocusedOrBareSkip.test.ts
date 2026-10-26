import fs from 'fs';
import path from 'path';

// Static guard — no committed test is focused, and none is skipped without a
// reason (docs/plans/testing-strategy-refresh-plan.md PR C, G5). A committed
// `.only` makes CI run one test and report the file green; a bare `.skip`
// silently drops coverage nobody decided to drop. Same rules as the backend's
// backend/tests/guards/noFocusedOrBareSkip.test.js, plus Playwright's
// `test.fixme`, which is a skip.
//
// Rules, over the Jest tests in app/ and lib/ and the Playwright specs in e2e/:
//   1. No focused test: `.only(` or Jest's `fit(` / `fdescribe(` aliases.
//   2. A skipped test (`describe|it|test.skip`, `test.fixme`, `xit(`,
//      `xdescribe(`, `xtest(`) carries its reason: a `//` comment of at least
//      five words on the same line or in the comment block directly above it.

const FRONTEND_ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_ROOTS = ['app', 'lib', 'e2e'].map((dir) => path.join(FRONTEND_ROOT, dir));
const SELF = path.resolve(__filename);
const MIN_REASON_WORDS = 5;

const FOCUSED = /(?:\.only\s*\(|(?<![\w.])(?:fit|fdescribe)\s*\()/;
const SKIPPED = /(?:\b(?:describe|it|test)\.(?:skip|fixme)\b|(?<![\w.])(?:xit|xdescribe|xtest)\s*\()/;

interface Violation {
  line: number;
  rule: 'focused' | 'skip without a reason';
}

function commentWords(line: string): number {
  const at = line.indexOf('//');
  if (at === -1) return 0;
  return line
    .slice(at + 2)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Words in the run of `//` comment lines directly above line `index` (blank lines between are skipped). */
function commentBlockWordsAbove(lines: string[], index: number): number {
  let previous = index - 1;
  while (previous >= 0 && lines[previous].trim() === '') previous--;
  let words = 0;
  while (previous >= 0 && lines[previous].trim().startsWith('//')) words += commentWords(lines[previous--]);
  return words;
}

function findViolations(source: string): Violation[] {
  const lines = source.split(/\r?\n/);
  const violations: Violation[] = [];
  lines.forEach((text, i) => {
    if (FOCUSED.test(text)) violations.push({ line: i + 1, rule: 'focused' });
    if (!SKIPPED.test(text)) return;
    const reasoned = commentWords(text) >= MIN_REASON_WORDS || commentBlockWordsAbove(lines, i) >= MIN_REASON_WORDS;
    if (!reasoned) violations.push({ line: i + 1, rule: 'skip without a reason' });
  });
  return violations;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.test\.tsx?$|\.spec\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('no focused or reasonless skipped tests (frontend)', () => {
  const files = SCAN_ROOTS.flatMap((root) => walk(root)).filter((file) => path.resolve(file) !== SELF);

  it('scans the Jest tests and the E2E specs (fails loudly on a wrong root)', () => {
    expect(files.filter((file) => file.endsWith('.spec.ts')).length).toBeGreaterThanOrEqual(5);
    expect(files.filter((file) => /\.test\.tsx?$/.test(file)).length).toBeGreaterThanOrEqual(60);
  });

  it('no test file is focused or skips a test without a reason', () => {
    const offenders = files.flatMap((file) => {
      const rel = path.relative(FRONTEND_ROOT, file).split(path.sep).join('/');
      return findViolations(fs.readFileSync(file, 'utf8')).map((v) => `${rel}:${v.line} (${v.rule})`);
    });

    expect(offenders).toEqual([]);
  });

  describe('matcher self-test', () => {
    it.each(['it.only("x", () => {});', 'test.describe.only("x", () => {});', 'fit("x", () => {});', 'fdescribe("x", () => {});'])(
      'flags focused %s',
      (source) => {
        expect(findViolations(source)).toEqual([{ line: 1, rule: 'focused' }]);
      }
    );

    it.each(['it.skip("x", () => {});', 'test.skip("x", async () => {});', 'test.fixme("x", async () => {});', 'xit("x", () => {});', 'xtest("x", () => {});'])(
      'flags reasonless %s',
      (source) => {
        expect(findViolations(source)).toEqual([{ line: 1, rule: 'skip without a reason' }]);
      }
    );

    it('accepts a skip with a five-word reason on the line above, past blank lines', () => {
      expect(findViolations('// No CI-rendered baseline exists yet\n\ntest.skip("x", async () => {});')).toEqual([]);
    });

    it('accepts a reason spread over a comment block whose last line is short', () => {
      expect(findViolations('// Un-skip once a baseline is generated\n// from the CI container.\nit.skip("x", () => {});')).toEqual([]);
    });

    it('does not take a reason from a comment above an unrelated line', () => {
      expect(findViolations('// The home page baseline above is skipped\n});\nit.skip("x", () => {});')).toEqual([
        { line: 3, rule: 'skip without a reason' },
      ]);
    });

    it('rejects a reason shorter than five words', () => {
      expect(findViolations('// flaky, fix later\ntest.skip("x", async () => {});')).toEqual([
        { line: 2, rule: 'skip without a reason' },
      ]);
    });

    it('does not flag look-alike names', () => {
      expect(findViolations('const profit = benefit(1); onlyOnce(); skipped();')).toEqual([]);
    });
  });
});
