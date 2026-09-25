import { eventTimeRange, formatDayHeading, groupByDay } from '../../../lib/calendarView';
import { formatMoney } from '../../../lib/formatMoney';
import type { CalendarEvent } from '../../../lib/types';
import EventChip from './EventChip';
import styles from './CalendarView.module.css';

export interface AgendaListProps {
  events: CalendarEvent[];
  eventHref: (event: CalendarEvent) => string | null;
}

/** The id of a day's heading — "+N more" in the month grid focuses it. */
export function agendaDayId(day: string): string {
  return `calendar-day-${day}`;
}

// Where it happens and for whom — every value straight from the event; the
// price is the backend's single-session price, formatted only.
function detailsLine(event: CalendarEvent): string {
  const details: string[] = [];
  if (event.coach) details.push(event.coach.name);
  if (event.locationName) details.push(event.locationName);
  if (event.levelName) details.push(event.levelName);
  if (event.price !== null) details.push(`${formatMoney(event.price)} / session`);
  if (event.students.length > 0) details.push(`For ${event.students.map((student) => student.name).join(', ')}`);
  if (event.kind === 'group' && event.isHoliday && event.holidayName) details.push(`Holiday — ${event.holidayName}`);
  return details.join(' · ');
}

// Events under day headings — the default on a phone (C10). Only days that
// have events are listed, in the server's order.
export default function AgendaList({ events, eventHref }: AgendaListProps) {
  const days = Array.from(groupByDay(events).entries());

  return (
    <div className={styles.agenda}>
      {days.map(([day, dayEvents]) => (
        <section key={day} className={styles.agendaDay} aria-labelledby={agendaDayId(day)}>
          <h3 id={agendaDayId(day)} className={styles.agendaHeading} tabIndex={-1}>
            {formatDayHeading(day)}
          </h3>
          <ul className={styles.agendaEvents}>
            {dayEvents.map((event) => {
              const details = detailsLine(event);
              return (
                <li key={event.id} className={styles.agendaRow}>
                  <div className={styles.agendaTime}>{eventTimeRange(event)}</div>
                  <div className={styles.agendaBody}>
                    <EventChip event={event} href={eventHref(event)} />
                    {details ? <div className={styles.agendaDetails}>{details}</div> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
