// Static guard — no committed test is focused, and none is skipped without a
// reason (docs/plans/testing-strategy-refresh-plan.md PR C, G5). A committed
// `.only` makes CI run one test and report the whole file green; a bare
// `.skip` silently drops coverage nobody decided to drop. This repo has no
// ESLint, so this Jest test IS the gate. The frontend has the same guard
// (frontend/lib/__tests__/guards/noFocusedOrBareSkip.test.ts).
//
// Rules, over backend/tests/**/*.test.js:
//   1. No focused test: `.only(` or Jest's `fit(` / `fdescribe(` aliases.
//   2. A skipped test (`describe|it|test.skip`, `xit(`, `xdescribe(`,
//      `xtest(`) carries its reason: a `//` comment of at least five words on
//      the same line or in the comment block directly above it.

const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.join(__dirname, '..');
const SELF = path.resolve(__filename);
const MIN_REASON_WORDS = 5;

const FOCUSED = /(?:\.only\s*\(|(?<![\w.])(?:fit|fdescribe)\s*\()/;
const SKIPPED = /(?:\b(?:describe|it|test)\.skip\b|(?<![\w.])(?:xit|xdescribe|xtest)\s*\()/;

function commentWords(line) {
  const at = line.indexOf('//');
  if (at === -1) return 0;
  return line
    .slice(at + 2)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Words in the run of `//` comment lines directly above line `index` (blank lines between are skipped). */
function commentBlockWordsAbove(lines, index) {
  let previous = index - 1;
  while (previous >= 0 && lines[previous].trim() === '') previous--;
  let words = 0;
  while (previous >= 0 && lines[previous].trim().startsWith('//')) words += commentWords(lines[previous--]);
  return words;
}

/** Returns `{ line, rule }` for each violation in `source` (1-based lines). */
function findViolations(source) {
  const lines = source.split(/\r?\n/);
  const violations = [];
  lines.forEach((text, i) => {
    if (FOCUSED.test(text)) violations.push({ line: i + 1, rule: 'focused' });
    if (!SKIPPED.test(text)) return;
    const reasoned = commentWords(text) >= MIN_REASON_WORDS || commentBlockWordsAbove(lines, i) >= MIN_REASON_WORDS;
    if (!reasoned) violations.push({ line: i + 1, rule: 'skip without a reason' });
  });
  return violations;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

describe('no focused or reasonless skipped tests (backend)', () => {
  const files = walk(TESTS_ROOT).filter((file) => path.resolve(file) !== SELF);

  it('scans the whole suite (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
  });

  it('no test file is focused or skips a test without a reason', () => {
    const offenders = files.flatMap((file) => {
      const rel = path.relative(TESTS_ROOT, file).split(path.sep).join('/');
      return findViolations(fs.readFileSync(file, 'utf8')).map((v) => `tests/${rel}:${v.line} (${v.rule})`);
    });

    if (offenders.length > 0) {
      throw new Error(
        `Focused or reasonless skipped tests:\n  ${offenders.join('\n  ')}\n` +
          'Remove the .only; give every .skip a // reason of at least five words on its line or in the comment block above it.'
      );
    }
  });

  describe('matcher self-test', () => {
    it.each(['it.only("x", () => {});', 'describe.only("x", () => {});', 'test.only("x", () => {});', 'fit("x", () => {});', 'fdescribe("x", () => {});'])(
      'flags focused %s',
      (source) => {
        expect(findViolations(source)).toEqual([{ line: 1, rule: 'focused' }]);
      }
    );

    it.each(['it.skip("x", () => {});', 'describe.skip("x", () => {});', 'test.skip("x", () => {});', 'xit("x", () => {});', 'xdescribe("x", () => {});', 'xtest("x", () => {});'])(
      'flags reasonless %s',
      (source) => {
        expect(findViolations(source)).toEqual([{ line: 1, rule: 'skip without a reason' }]);
      }
    );

    it('accepts a skip with a five-word reason on the line above, past blank lines', () => {
      expect(findViolations('// Needs a real Square sandbox account\n\nit.skip("x", () => {});')).toEqual([]);
    });

    it('accepts a skip with a five-word reason on the same line', () => {
      expect(findViolations('it.skip("x", () => {}); // needs a real sandbox account')).toEqual([]);
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
      expect(findViolations('// flaky, fix later\nit.skip("x", () => {});')).toEqual([{ line: 2, rule: 'skip without a reason' }]);
    });

    it('does not flag look-alike names', () => {
      expect(findViolations('const profit = benefit(1); onlyOnce(); jest.fn().skipped;')).toEqual([]);
    });
  });
});
