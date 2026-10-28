import { formatDateOnly, formatInstant } from './formatDate';
import { formatTime } from './formatTime';
import { DAY_LABELS } from './constants';
import { formatMoney } from './formatMoney';
import type {
  CoachContract,
  PackQuoteRow,
  PrivateAttendance,
  PrivateBookingStatus,
  PrivatePurchaseOption,
  PrivateWindowRemovalResult,
  SessionPriceRow,
} from './types';

// Display helpers shared by every private-lesson page (public listing,
// booking wizard, parent, coach and admin views) — one wording per concept.
// Formatting only: every value comes from the backend.

/** "Tue, Oct 6, 2026, 4:30 PM" — a booking's startDate is a real instant. */
export function formatLessonTime(iso: string): string {
  return formatInstant(iso, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "Tue, Oct 6" — the date half of a bookable lesson, for a date picker. */
export function formatLessonDay(iso: string): string {
  return formatInstant(iso, { weekday: 'short', year: undefined });
}

/** "4:30 PM" — the Central time half of a bookable lesson. */
export function formatLessonClock(iso: string): string {
  return formatInstant(iso, { hour: 'numeric', minute: '2-digit', month: undefined, day: undefined, year: undefined });
}

/** "Oct 1, 2026 – Dec 31, 2026" — a rule's bookable range (calendar-day sentinels). */
export function formatRuleRange(rule: { startDate: string; endDate: string }): string {
  return `${formatDateOnly(rule.startDate)} – ${formatDateOnly(rule.endDate)}`;
}

// ── Availability windows ──────────────────────────────────────────────────
// Bulk publish stores one rule per slot ("Tue 6–8 pm, 15 min" = 8 rules at
// 6:00, 6:15 … 7:45). The coach and admin tables show them back as the
// window they were published as: back-to-back rules of the same coach,
// weekday, length and bookable range. Display grouping only — every field
// is the rules' own. Works on the coach/admin rules and on the public
// listing's slots alike (the latter carry no bookedCount).

interface WindowableRule {
  dayOfWeek: number;
  startTime: string;
  durationMinutes: number;
  startDate: string;
  endDate: string;
  bookedCount?: number;
}

export interface AvailabilityWindow<R extends WindowableRule> {
  key: string;
  rules: R[];
  dayOfWeek: number;
  /** "HH:mm" — the first slot's start. */
  startTime: string;
  /** "HH:mm" — the last slot's end. */
  endTime: string;
  durationMinutes: number;
  startDate: string;
  endDate: string;
  /** Upcoming bookings across every slot in the window. */
  bookedCount: number;
}

function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

function hhmmOf(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function toWindow<R extends WindowableRule>(coachKey: string, run: R[]): AvailabilityWindow<R> {
  const first = run[0];
  const last = run[run.length - 1];
  return {
    key: [coachKey, first.dayOfWeek, first.startTime, first.durationMinutes, first.startDate, first.endDate].join('|'),
    rules: run,
    dayOfWeek: first.dayOfWeek,
    startTime: first.startTime,
    endTime: hhmmOf(minutesOf(last.startTime) + last.durationMinutes),
    durationMinutes: first.durationMinutes,
    startDate: first.startDate,
    endDate: first.endDate,
    bookedCount: run.reduce((sum, rule) => sum + (rule.bookedCount ?? 0), 0),
  };
}

/**
 * Groups rules into windows, ordered by coach (first seen), weekday, then
 * start time. `coachKeyOf` names each rule's coach (the coach's own page has
 * just one).
 */
export function groupAvailabilityWindows<R extends WindowableRule>(
  rules: R[],
  coachKeyOf: (rule: R) => string
): AvailabilityWindow<R>[] {
  const coachOrder = new Map<string, number>();
  const groups = new Map<string, R[]>();

  rules.forEach((rule) => {
    const coachKey = coachKeyOf(rule);
    if (!coachOrder.has(coachKey)) coachOrder.set(coachKey, coachOrder.size);
    const key = [coachKey, rule.dayOfWeek, rule.durationMinutes, rule.startDate, rule.endDate].join('|');
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  });

  const windows: { coach: number; window: AvailabilityWindow<R> }[] = [];

  groups.forEach((group) => {
    const coachKey = coachKeyOf(group[0]);
    const coach = coachOrder.get(coachKey) ?? 0;
    const sorted = [...group].sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
    let run: R[] = [];

    sorted.forEach((rule) => {
      const previous = run[run.length - 1];
      if (previous && minutesOf(rule.startTime) !== minutesOf(previous.startTime) + previous.durationMinutes) {
        windows.push({ coach, window: toWindow(coachKey, run) });
        run = [];
      }
      run.push(rule);
    });

    windows.push({ coach, window: toWindow(coachKey, run) });
  });

  return windows
    .sort(
      (a, b) =>
        a.coach - b.coach ||
        a.window.dayOfWeek - b.window.dayOfWeek ||
        minutesOf(a.window.startTime) - minutesOf(b.window.startTime)
    )
    .map(({ window }) => window);
}

/** "Tuesdays". */
export function formatWindowDay(window: { dayOfWeek: number }): string {
  return `${DAY_LABELS[window.dayOfWeek]}s`;
}

/** "6:00 PM–8:00 PM". */
export function formatWindowTime(window: { startTime: string; endTime: string }): string {
  return `${formatTime(window.startTime)}–${formatTime(window.endTime)}`;
}

/** "Tuesdays · 6:00 PM–8:00 PM" — names a window in a button or dialog. */
export function formatWindowLabel(window: { dayOfWeek: number; startTime: string; endTime: string }): string {
  return `${formatWindowDay(window)} · ${formatWindowTime(window)}`;
}

/**
 * The notice after removing a window slot by slot: success, or which slots
 * the backend kept and why (a booking made since the page loaded).
 */
export function windowRemovalMessage(
  window: AvailabilityWindow<WindowableRule & { _id: string }>,
  result: PrivateWindowRemovalResult
): { ok: boolean; message: string } {
  if (result.failures.length === 0) {
    return {
      ok: true,
      message: result.retired > 0 ? 'Availability removed — slots with past lessons stay on record.' : 'Availability removed.',
    };
  }

  const startTimeById = new Map(window.rules.map((rule) => [rule._id, rule.startTime]));
  const keptTimes = result.failures.map((failure) => formatTime(startTimeById.get(failure.id) ?? '00:00'));
  const reasons = [...new Set(result.failures.map((failure) => failure.message))].join(' ');
  const done = result.removed + result.retired;
  const lead = done === 0 ? 'Nothing was removed.' : `Removed ${done} of ${window.rules.length} slots.`;

  return {
    ok: false,
    message: `${lead} ${keptTimes.join(', ')} ${keptTimes.length === 1 ? "wasn't" : "weren't"} removed: ${reasons}`,
  };
}

/** The one label for where a booking stands. */
export function bookingStatusLabel(booking: { status: PrivateBookingStatus; attendance: PrivateAttendance }): string {
  if (booking.status === 'cancelled') return 'Cancelled';
  if (booking.attendance === 'attended') return 'Attended';
  if (booking.attendance === 'missed') return 'Missed';
  return 'Booked';
}

/** "Dana Cole", or a fallback for a person deleted without a guard. */
export function personName(
  person: { firstName: string; lastName: string } | null | undefined,
  fallback: string
): string {
  return person ? `${person.firstName} ${person.lastName}` : fallback;
}

/** "10 sessions" / "1 session". */
export function sessionCount(count: number): string {
  return count === 1 ? '1 session' : `${count} sessions`;
}

/** "8 slots" / "1 slot". */
export function slotCount(count: number): string {
  return count === 1 ? '1 slot' : `${count} slots`;
}

// ── Purchase options and packs (docs/plans/coach-pack-pricing-plan.md) ───────
// Every figure below is a backend value (the quote, the public listing, the
// ledger row, the contract editor's preview); these only format it.

/** "Buy 10 sessions" / "Buy 1 session" — a purchase option in the booking wizard. */
export function purchaseOptionLabel(option: PrivatePurchaseOption): string {
  return `Buy ${sessionCount(option.quantity)}`;
}

/** "$300.00 · save $25.00", or "$32.50" when the option saves nothing. */
export function purchaseOptionPrice(option: PrivatePurchaseOption): string {
  return option.savings > 0
    ? `${formatMoney(option.total)} · save ${formatMoney(option.savings)}`
    : formatMoney(option.total);
}

/** "10 lessons for $300.00" — a coach's pack on the public listing. */
export function packListingLabel(option: PrivatePurchaseOption): string {
  return `${option.quantity} lessons for ${formatMoney(option.total)}`;
}

/** "Saved $25.00" — what a completed purchase saved, from the ledger. */
export function packSavingsLabel(savings: number): string {
  return `Saved ${formatMoney(savings)}`;
}

/**
 * The pack editor's preview line for one pack: "$30.00 per lesson · saves
 * $25.00 (8%)", or the backend's own refusal message.
 */
export function packPreviewLabel(quote: PackQuoteRow): string {
  if (quote.error) return quote.error;
  if (quote.perLessonPrice === null || quote.savings === null || quote.savingsPercent === null) return '';
  return `${formatMoney(quote.perLessonPrice)} per lesson · saves ${formatMoney(quote.savings)} (${quote.savingsPercent}%)`;
}

/** "Lesson prices: 30 min $30.00 · 60 min $60.00" — shown under the hourly rate. */
export function sessionPricesLabel(rows: SessionPriceRow[]): string {
  return `Lesson prices: ${rows.map((row) => `${row.durationMinutes} min ${formatMoney(row.price)}`).join(' · ')}`;
}

/** "Current" / "Replaced" / "Ended" — where a contract version stands (plan §8). */
export function contractStatusLabel(contract: Pick<CoachContract, 'isActive' | 'endReason'>): string {
  if (contract.isActive) return 'Current';
  if (contract.endReason === 'revised') return 'Replaced';
  if (contract.endReason === 'deactivated') return 'Ended';
  return 'Inactive';
}
