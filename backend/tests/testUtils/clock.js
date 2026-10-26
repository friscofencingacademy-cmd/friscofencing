// The one home for pinning the clock in a backend test (docs/plans/
// duplication-cleanup-plan.md D1; docs/plans/testing-strategy-refresh-plan.md
// PR D). Fakes ONLY `Date`: the MongoDB driver, supertest and the payment
// provider's SDK all need real timers, or the suite hangs. With timers real
// the fake clock never ticks, so `Date.now()` stays at the pinned instant
// until the next freezeAt()/jest.setSystemTime().
//
// Older copies of REAL_TIMERS still live in a few files; duplication-cleanup
// D1 moves them here.

const REAL_TIMERS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick'];

/** Pin `Date` to a literal instant, e.g. freezeAt('2026-10-15T15:00:00.000Z'). Pair with jest.useRealTimers(). */
function freezeAt(iso) {
  const now = new Date(iso);
  if (Number.isNaN(now.getTime())) throw new Error(`freezeAt: not an ISO instant: ${iso}`);
  jest.useFakeTimers({ now, doNotFake: REAL_TIMERS });
  return now;
}

module.exports = { freezeAt, REAL_TIMERS };
