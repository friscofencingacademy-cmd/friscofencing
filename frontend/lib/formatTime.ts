/**
 * "16:00" -> "4:00 PM". Plain wall-clock formatting, no timezone conversion —
 * a schedule's "HH:mm" field is already local, so it's parsed as literal UTC
 * digits purely to borrow Intl's AM/PM formatting, not to convert a real
 * instant. This mirrors backend/src/email/dates.js's timeOfDay() exactly, so
 * a given "HH:mm" renders identically here and in email — frontend and
 * backend share no code (see CLAUDE.md), but this keeps the same algorithm
 * on both sides by design, not by accident.
 */
export function formatTime(hhmm: string): string {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const asUtc = new Date(Date.UTC(2000, 0, 1, hours, minutes));

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(asUtc);
}
