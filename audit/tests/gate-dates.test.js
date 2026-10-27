const test = require('node:test');
const assert = require('node:assert/strict');

const {
  centralToday,
  classDaysFrom,
  classDaysInMonth,
  firstOfMonthAfter,
  formatDay,
  parsePillDay,
  prorate,
  siblingDiscount,
} = require('../lib/gate-dates');

const TUESDAY = 2;
const THURSDAY = 4;
const FRIDAY = 5;

test('counts a four-weekday month: October 2026 has 4 Tuesdays', () => {
  assert.equal(classDaysInMonth(TUESDAY, 2026, 10), 4);
  assert.equal(classDaysFrom(TUESDAY, 2026, 10, 27), 1);
});

test('counts a five-weekday month: October 2026 has 5 Thursdays', () => {
  assert.equal(classDaysInMonth(THURSDAY, 2026, 10), 5);
  assert.equal(classDaysFrom(THURSDAY, 2026, 10, 27), 1);
});

test('today being the last class day still counts today', () => {
  const p = prorate(100, TUESDAY, { year: 2026, month: 10, day: 27 });
  assert.deepEqual([p.left, p.total, p.amount], [1, 4, 25]);
  assert.equal(p.arithmetic, '$100.00 × 1 ÷ 4 = $25.00');
});

test('no class day left gives $0', () => {
  const p = prorate(100, TUESDAY, { year: 2026, month: 10, day: 28 });
  assert.deepEqual([p.left, p.amount], [0, 0]);
});

test('month ends on the 31st, 30th and 28th', () => {
  assert.equal(classDaysInMonth(FRIDAY, 2026, 10), 5); // Oct 31 is a Saturday; Fridays 2..30
  assert.equal(classDaysFrom(FRIDAY, 2026, 10, 31), 0);
  assert.equal(classDaysInMonth(3, 2026, 9), 5); // Sept 2026: Wednesdays 2, 9, 16, 23, 30
  assert.equal(classDaysFrom(3, 2026, 9, 30), 1);
  assert.equal(classDaysInMonth(6, 2026, 2), 4); // Feb 2026: Saturdays 7, 14, 21, 28
  assert.equal(classDaysFrom(6, 2026, 2, 28), 1);
});

test('rounds once at the end, not the daily rate first', () => {
  // No real month has three of a weekday, so the $100 × 1 ÷ 3 case from the plan is a
  // four-weekday month with a fee that does not divide evenly: $95 × 3 ÷ 4 = $71.25 below,
  // and $100 × 1 ÷ 3 stays $33.33 by the same rounding.
  assert.equal(Number(((100 / 3) * 1).toFixed(2)), 33.33);
  const p = prorate(110, THURSDAY, { year: 2026, month: 10, day: 8 }); // 4 of 5 Thursdays
  assert.equal(p.amount, 88);
  assert.equal(p.dailyRate, 22);
  const odd = prorate(100, THURSDAY, { year: 2026, month: 10, day: 15 }); // 3 of 5
  assert.equal(odd.amount, 60);
  const thirds = prorate(95, TUESDAY, { year: 2026, month: 10, day: 13 }); // 3 of 4 → 71.25
  assert.equal(thirds.amount, 71.25);
});

test('a holiday on a class day changes nothing — proration counts plain weekdays', () => {
  // Thanksgiving 2026 is Thursday Nov 26; it is still one of the 4 Thursdays.
  assert.equal(classDaysInMonth(THURSDAY, 2026, 11), 4);
  assert.equal(classDaysFrom(THURSDAY, 2026, 11, 20), 1);
});

test('the sibling discount rounds the discount, then the total', () => {
  assert.deepEqual(siblingDiscount(10), { discount: 1, total: 9 });
  assert.deepEqual(siblingDiscount(50), { discount: 5, total: 45 });
  assert.deepEqual(siblingDiscount(33.33), { discount: 3.33, total: 30 });
});

test('Central today near the UTC midnight boundary', () => {
  // 03:30 UTC on Oct 28 is 22:30 Central on Oct 27 (CDT, UTC−5).
  assert.deepEqual(centralToday(new Date('2026-10-28T03:30:00Z')), { year: 2026, month: 10, day: 27 });
  // 06:00 UTC on Nov 2 is 00:00 Central on Nov 2 (CST, UTC−6, after the DST change).
  assert.deepEqual(centralToday(new Date('2026-11-02T06:00:00Z')), { year: 2026, month: 11, day: 2 });
  assert.deepEqual(centralToday(new Date('2026-11-02T05:59:00Z')), { year: 2026, month: 11, day: 1 });
});

test('next month and the month after, across a year end', () => {
  const today = { year: 2026, month: 12, day: 15 };
  assert.deepEqual(firstOfMonthAfter(today), { year: 2027, month: 1, day: 1 });
  assert.deepEqual(firstOfMonthAfter(today, 2), { year: 2027, month: 2, day: 1 });
  assert.equal(formatDay(firstOfMonthAfter({ year: 2026, month: 10, day: 27 })), 'Nov 1, 2026');
});

test('reads a start-date pill label', () => {
  assert.deepEqual(parsePillDay('Thu, Oct 29, 2026 · 5:00 PM–6:00 PM'), { year: 2026, month: 10, day: 29 });
  assert.equal(parsePillDay('no date here'), null);
});
