import { DAY_LABELS } from '../../../lib/constants';
import { formatTime } from '../../../lib/formatTime';
import type { PublicGroupClassSchedule } from '../../../lib/types';
import Button from '../ui/Button/Button';
import Card from '../ui/Card/Card';
import styles from '../ui/shared.module.css';

interface ScheduleTableProps {
  schedules: PublicGroupClassSchedule[];
  // True when the returned rows span more than one distinct timezone — the
  // page-level "All times shown in X" line only makes sense for a single
  // zone (docs/plans/frontend-polish-plan.md PR 4, finding B2), so each row
  // names its own zone instead when this is set.
  showTimezone?: boolean;
}

function ScheduleRow({ schedule, showTimezone }: { schedule: PublicGroupClassSchedule; showTimezone: boolean }) {
  // `availability` is only present in schedule-based mode (see
  // PublicGroupClassSchedule) — no pill at all in premium, the live
  // default, since one schedule's roster filling up doesn't mean the level
  // has no room; every row just books.
  const isOpen = schedule.availability !== 'full';

  return (
    <div className={styles.scheduleRow}>
      <div>
        <div className={styles.scheduleRowTitle}>
          {schedule.className} · {schedule.levelName}
        </div>
        <div className={styles.pageSubtitle}>
          {formatTime(schedule.startTime)}–{formatTime(schedule.endTime)} · {schedule.locationName} · Coach{' '}
          {schedule.coachName}
          {showTimezone ? ` · ${schedule.timezone}` : ''}
        </div>
      </div>
      <div className={styles.scheduleRowActions}>
        {schedule.availability !== undefined && (
          <span
            className={`${styles.availabilityPill} ${
              isOpen ? styles.availabilityOpen : styles.availabilityFull
            }`}
          >
            {isOpen ? 'Open' : 'Class full'}
          </span>
        )}
        {isOpen ? (
          <Button as="a" href="/register?next=/parent/book-trial" size="sm">
            Book a Free Trial
          </Button>
        ) : (
          <Button size="sm" disabled>
            Book a Free Trial
          </Button>
        )}
      </div>
    </div>
  );
}

// Groups a (possibly pre-filtered) schedule list by dayOfWeek and renders
// one Card per day that has any classes. Renders nothing itself when
// `schedules` is empty — the caller owns the empty-state message, since
// "no classes at all" and "no classes for this filter" read differently.
export default function ScheduleTable({ schedules, showTimezone = false }: ScheduleTableProps) {
  const schedulesByDay: PublicGroupClassSchedule[][] = DAY_LABELS.map(() => []);
  schedules.forEach((schedule) => {
    schedulesByDay[schedule.dayOfWeek].push(schedule);
  });

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {DAY_LABELS.map((dayName, dayIndex) =>
        schedulesByDay[dayIndex].length === 0 ? null : (
          <Card key={dayName}>
            <h3 style={{ marginTop: 0 }}>{dayName}</h3>
            <div>
              {schedulesByDay[dayIndex].map((schedule, index) => (
                <ScheduleRow
                  key={`${schedule.className}-${schedule.startTime}-${index}`}
                  schedule={schedule}
                  showTimezone={showTimezone}
                />
              ))}
            </div>
          </Card>
        )
      )}
    </div>
  );
}
