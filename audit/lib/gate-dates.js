// Central-time calendar and proration helpers for live-gate preconditions
// (docs/plans/playwright-live-gates-plan.md D5). Pure: no Date.now() except
// through the `now` argument, so tests pin the clock.
//
// The rules are the backend's computeProration (backend/src/services/
// billing/proration.service.js, ADR 007):
//  - a level's class days are the plain occurrences of its weekday in the
//    calendar month. Holidays are NOT subtracted: computeProration loops over
//    the days and never reads the Holiday model.
//  - the amount is fee ÷ total × remaining, rounded once at the end
//    (toFixed(2)), never by rounding the daily rate first.
//  - the sibling discount is round2(base × 0.1) and the total is
//    round2(base − discount) (calculateChargeAmount.service.js).
//
// A "day" here is a plain { year, month (1-12), day } in Central time.

const ACADEMY_TIMEZONE = 'America/Chicago';

function centralToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ACADEMY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const lookup = {};
  parts.forEach((part) => {
    lookup[part.type] = part.value;
  });
  return { year: Number(lookup.year), month: Number(lookup.month), day: Number(lookup.day) };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// Occurrences of `weekday` (0 = Sunday) from `fromDay` through month end, inclusive.
function classDaysFrom(weekday, year, month, fromDay) {
  let count = 0;
  for (let day = fromDay; day <= daysInMonth(year, month); day += 1) {
    if (weekdayOf(year, month, day) === weekday) count += 1;
  }
  return count;
}

function classDaysInMonth(weekday, year, month) {
  return classDaysFrom(weekday, year, month, 1);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// The prorated amount, daily rate and the arithmetic as one readable line,
// for `fee` starting on `start` (a day) for a level meeting on `weekday`.
function prorate(fee, weekday, start) {
  const total = classDaysInMonth(weekday, start.year, start.month);
  const left = classDaysFrom(weekday, start.year, start.month, start.day);
  const amount = Number(((fee / total) * left).toFixed(2));
  const dailyRate = Number((fee / total).toFixed(2));
  return {
    total,
    left,
    amount,
    dailyRate,
    arithmetic: `${money(fee)} × ${left} ÷ ${total} = ${money(amount)}`,
  };
}

function siblingDiscount(base) {
  const discount = round2(base * 0.1);
  return { discount, total: round2(base - discount) };
}

function firstOfMonthAfter(day, monthsAhead = 1) {
  const date = new Date(Date.UTC(day.year, day.month - 1 + monthsAhead, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: 1 };
}

// "Oct 27, 2026" — the app's formatDateOnly / formatInstant default shape.
function formatDay(day) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(day.year, day.month - 1, day.day))
  );
}

// A calendar-day sentinel ISO string (UTC midnight) as a day.
function daySentinel(iso) {
  const date = new Date(iso);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

// A real instant, as the Central day it falls on.
function instantDay(iso) {
  return centralToday(new Date(iso));
}

function isoDay(day) {
  return `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}

function compareDays(a, b) {
  return a.year * 10000 + a.month * 100 + a.day - (b.year * 10000 + b.month * 100 + b.day);
}

function money(amount) {
  return `$${amount.toFixed(2)}`;
}

// The start-date pill's label, e.g. "Thu, Oct 29, 2026", as a day.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parsePillDay(label) {
  const match = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(label);
  if (!match || !MONTHS.includes(match[1])) return null;
  return { year: Number(match[3]), month: MONTHS.indexOf(match[1]) + 1, day: Number(match[2]) };
}

module.exports = {
  ACADEMY_TIMEZONE,
  centralToday,
  classDaysFrom,
  classDaysInMonth,
  compareDays,
  daySentinel,
  firstOfMonthAfter,
  formatDay,
  instantDay,
  isoDay,
  money,
  parsePillDay,
  prorate,
  round2,
  siblingDiscount,
  weekdayOf,
};
