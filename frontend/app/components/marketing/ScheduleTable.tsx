import { DAY_LABELS } from '../../../lib/constants';
import type { PublicGroupClassSchedule } from '../../../lib/types';
import Button from '../ui/Button/Button';
import Card from '../ui/Card/Card';
import styles from '../ui/shared.module.css';

interface ScheduleTableProps {
  schedules: PublicGroupClassSchedule[];
}

function ScheduleRow({ schedule }: { schedule: PublicGroupClassSchedule }) {
  const isOpen = schedule.availability === 'open';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) 0',
        borderTop: '1px solid var(--color-border)',
        flexWrap: 'wrap',
      }}
    >
      <div>
        <div style={{ fontWeight: 600 }}>
          {schedule.className} · {schedule.levelName}
        </div>
        <div className={styles.pageSubtitle}>
          {schedule.startTime}–{schedule.endTime} · {schedule.locationName} · Coach{' '}
          {schedule.coachName}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span
          className={`${styles.availabilityPill} ${
            isOpen ? styles.availabilityOpen : styles.availabilityFull
          }`}
        >
          {isOpen ? 'Open' : 'Class full'}
        </span>
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
export default function ScheduleTable({ schedules }: ScheduleTableProps) {
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
                />
              ))}
            </div>
          </Card>
        )
      )}
    </div>
  );
}
