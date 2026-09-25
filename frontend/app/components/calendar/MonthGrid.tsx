import { DAY_LABELS } from '../../../lib/constants';
import {
  formatDayHeading,
  formatMonthTitle,
  groupByDay,
  monthGrid,
  type CalendarMonth,
} from '../../../lib/calendarView';
import type { CalendarEvent } from '../../../lib/types';
import Button from '../ui/Button/Button';
import EventChip from './EventChip';
import styles from './CalendarView.module.css';

// How many events a day cell shows before "+N more".
export const MAX_EVENTS_PER_CELL = 3;

export interface MonthGridProps {
  month: CalendarMonth;
  today: string;
  events: CalendarEvent[];
  eventHref: (event: CalendarEvent) => string | null;
  onShowDay: (day: string) => void;
}

// A plain table: 7 weekday columns, 6 weeks. Each day lists its events by the
// server's `day` string (never from an instant). A real <table> rather than
// role="grid" — a grid promises arrow-key cell navigation; this is a table of
// links, reached with Tab like any other.
export default function MonthGrid({ month, today, events, eventHref, onShowDay }: MonthGridProps) {
  const days = monthGrid(month);
  const eventsByDay = groupByDay(events);
  const weeks = Array.from({ length: days.length / 7 }, (_unused, week) => days.slice(week * 7, week * 7 + 7));

  return (
    <table className={styles.grid}>
      <caption className={styles.srOnly}>{formatMonthTitle(month)}</caption>
      <thead>
        <tr>
          {DAY_LABELS.map((label) => (
            <th key={label} scope="col" abbr={label} className={styles.weekday}>
              {label.slice(0, 3)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0].day}>
            {week.map((cell) => {
              const dayEvents = eventsByDay.get(cell.day) ?? [];
              const hidden = dayEvents.length - MAX_EVENTS_PER_CELL;
              const isToday = cell.day === today;
              const cellClass = [
                styles.cell,
                cell.inMonth ? '' : styles.cellOtherMonth,
                isToday ? styles.cellToday : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <td key={cell.day} className={cellClass} aria-current={isToday ? 'date' : undefined}>
                  <span className={styles.dayNumber} aria-hidden="true">
                    {cell.dayOfMonth}
                  </span>
                  <span className={styles.srOnly}>{formatDayHeading(cell.day)}</span>
                  {dayEvents.length > 0 ? (
                    <ul className={styles.cellEvents}>
                      {dayEvents.slice(0, MAX_EVENTS_PER_CELL).map((event) => (
                        <li key={event.id}>
                          <EventChip event={event} href={eventHref(event)} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {hidden > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.moreButton}
                      aria-label={`${hidden} more on ${formatDayHeading(cell.day)}`}
                      onClick={() => onShowDay(cell.day)}
                    >
                      +{hidden} more
                    </Button>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
