import Link from 'next/link';

import { eventDescription, eventKindLabel, eventTime } from '../../../lib/calendarView';
import type { CalendarEvent } from '../../../lib/types';
import styles from './CalendarView.module.css';

export interface EventChipProps {
  event: CalendarEvent;
  href: string | null;
}

// One event, one look per kind (docs/plans/calendar-view-plan.md §2.3). The
// kind is always written out ("Open slot", "Class", …) — color is never the
// only signal.
function chipClass(event: CalendarEvent): string {
  if (event.kind === 'holiday' || event.isHoliday) return styles.chipHoliday;
  if (event.mine || event.kind === 'private-booked') return styles.chipBooked;
  if (event.kind === 'private-open') return styles.chipOpen;
  return styles.chipGroup;
}

export default function EventChip({ event, href }: EventChipProps) {
  const className = `${styles.chip} ${chipClass(event)}`;
  const content = (
    <>
      <span className={styles.chipKind}>{eventKindLabel(event)}</span>
      <span className={styles.chipTime}>{eventTime(event)}</span>
      <span className={styles.chipTitle}>{event.title}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} aria-label={eventDescription(event)}>
        {content}
      </Link>
    );
  }

  return <span className={className}>{content}</span>;
}
