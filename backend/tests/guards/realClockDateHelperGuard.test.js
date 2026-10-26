// Static guard — a backend test must not call a helper that reads the real
// clock (src/utils/billingDates.js's todayAtMidnight() / todayDateOnly()) in a
// file that does not pin the clock. Such a test only exercises whichever day
// or time-of-day branch the real clock lands on, then fails in one narrow
// window (docs/plans/testing-strategy-refresh-plan.md PR C, G10; the
// Wed/Tue-after-4pm-Central flake). Ported from CKQ's
// realClockDateHelperGuard.test.js.
//
// Deliberately narrow: it covers those helpers only. Code that calls
// moment()/new Date() internally is covered by docs/TESTING_STRATEGY.md's
// rule, not mechanically.

const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.join(__dirname, '..');

// Forward-slash paths relative to backend/tests — a regex on the raw path
// silently fails on Windows backslashes. Each entry says why, and the "still
// needed" test below fails once an exempted file pins its clock. Pin the clock
// (tests/testUtils/clock.js's freezeAt) rather than adding an entry.
const EXEMPT = new Map([
  ['guards/realClockDateHelperGuard.test.js', 'this guard (its self-test strings contain the flagged calls)'],
]);

// A call reads the real clock whatever its argument (the argument is a timezone).
const FLAGGED_PATTERNS = [/\btodayAtMidnight\(/, /\btodayDateOnly\(/];
// A comment line that names a helper is prose, not a call.
const COMMENT_LINE = /^\s*(\/\/|\/?\*)/;

// A bare jest.useFakeTimers() starts at the REAL time, so it is not a pin;
// only a literal `now` (or setSystemTime / testUtils' freezeAt or freezeDate) is.
const PINNED_PATTERNS = [/useFakeTimers\(\s*\{[^}]*\bnow\b/s, /setSystemTime\(/, /\bfreezeAt\(/, /\bfreezeDate\(/];

function isClockPinned(content) {
  return PINNED_PATTERNS.some((re) => re.test(content));
}

/** Returns the 1-based line numbers of unpinned real-clock helper calls ([] when pinned). */
function findViolations(content) {
  if (isClockPinned(content)) return [];
  const hits = [];
  content.split(/\r?\n/).forEach((line, i) => {
    if (COMMENT_LINE.test(line)) return;
    if (FLAGGED_PATTERNS.some((re) => re.test(line))) hits.push(i + 1);
  });
  return hits;
}

function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.name.endsWith('.test.js') || path.relative(TESTS_ROOT, full).split(path.sep)[0] === 'testUtils') {
      out.push(full);
    }
  }
  return out;
}

describe('real-clock date-helper guard', () => {
  const files = collectFiles(TESTS_ROOT).map((file) => ({
    file,
    rel: path.relative(TESTS_ROOT, file).split(path.sep).join('/'),
  }));

  it('scans the whole suite (fails loudly on a wrong root)', () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
  });

  it('no unpinned test calls a real-clock date helper', () => {
    const offenders = [];
    for (const { file, rel } of files) {
      if (EXEMPT.has(rel)) continue;
      findViolations(fs.readFileSync(file, 'utf8')).forEach((n) => offenders.push(`tests/${rel}:${n}`));
    }
    if (offenders.length > 0) {
      throw new Error(
        `Tests call a real-clock date helper without pinning the clock:\n  ${offenders.join('\n  ')}\n` +
          "Pin a literal instant with tests/testUtils/clock.js's freezeAt('<ISO instant>') " +
          'and assert literal dates. See docs/TESTING_STRATEGY.md.'
      );
    }
  });

  it('every exemption names a file that exists', () => {
    const missing = [...EXEMPT.keys()].filter((rel) => !fs.existsSync(path.join(TESTS_ROOT, rel)));
    expect(missing).toEqual([]);
  });

  it('every exemption is still needed (remove an entry once its file pins the clock)', () => {
    const stale = [...EXEMPT.keys()]
      .filter((rel) => rel !== 'guards/realClockDateHelperGuard.test.js')
      .filter((rel) => findViolations(fs.readFileSync(path.join(TESTS_ROOT, rel), 'utf8')).length === 0);
    expect(stale).toEqual([]);
  });

  describe('matcher self-test', () => {
    it('flags todayDateOnly() and todayAtMidnight() in an unpinned file', () => {
      expect(findViolations('const d = todayDateOnly();\nconst m = todayAtMidnight();')).toEqual([1, 2]);
    });

    it('flags a call with a timezone argument (it still reads the real clock)', () => {
      expect(findViolations("todayAtMidnight('America/Chicago')")).toEqual([1]);
    });

    it('does not flag a comment line that names a helper', () => {
      expect(findViolations('// dated with the real todayDateOnly() on purpose\n * todayAtMidnight() here')).toEqual([]);
    });

    it('does not flag the import line', () => {
      expect(findViolations("const { todayDateOnly } = require('../../src/utils/billingDates');")).toEqual([]);
    });

    it('treats a bare useFakeTimers() as unpinned (it starts at the real time)', () => {
      expect(findViolations('jest.useFakeTimers();\ntodayDateOnly();')).toEqual([2]);
    });

    it('does not flag calls in a file pinned with a literal now, setSystemTime, freezeAt or freezeDate', () => {
      expect(findViolations("freezeAt('2026-10-15T15:00:00.000Z');\ntodayDateOnly();")).toEqual([]);
      expect(findViolations("jest.useFakeTimers({\n  now: new Date('2026-10-15T15:00:00Z'),\n});\ntodayDateOnly();")).toEqual([]);
      expect(findViolations("jest.setSystemTime(new Date('2026-10-15T15:00:00Z'));\ntodayAtMidnight();")).toEqual([]);
      expect(findViolations('freezeDate();\ntodayDateOnly();')).toEqual([]);
    });
  });
});
