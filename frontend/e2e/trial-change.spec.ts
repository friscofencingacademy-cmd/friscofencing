import { test, expect } from './fixtures/test';

import type {
  GroupClassSessionsByClassResponse,
  MyStudentsResponse,
  SuccessResponse,
  TrialClassResponse,
} from '../lib/apiResponses';
import type { GroupClassSessionWithSchedule, Student, UpcomingTrial } from '../lib/types';
import { json, FIXTURE_LEVEL_A, FIXTURE_SCHEDULE_A, FIXTURE_STUDENT, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';
import { expectNoBlockingA11yViolations } from './helpers/a11y';
import { expectNoHorizontalOverflow } from './helpers/layout';

// Cancel and reschedule an upcoming trial in a real browser
// (docs/plans/trial-cancel-reschedule-plan.md): the dashboard's actions, the
// confirm dialog, the wizard's reschedule mode, and the exact request each
// mutation sends. Whether the actions show is the server's
// enrollment.trial.canChange; the mocks set it, the page never computes it.
// Clock pinned so no date on the page drifts.

const NOW = new Date('2026-10-26T15:00:00.000Z'); // a Monday

// Wed Nov 4 2026, 16:00–17:00 Central (CST, UTC-6 — DST ended Nov 1).
const TRIAL: UpcomingTrial = {
  _id: 'trial-1',
  sessionId: 'session-1',
  startsAt: '2026-11-04T22:00:00.000Z',
  endsAt: '2026-11-04T23:00:00.000Z',
  canChange: true,
};

const STUDENT_WITH_TRIAL: Student = {
  ...FIXTURE_STUDENT,
  enrollment: { status: 'trial_scheduled', canBookTrial: false, schedule: null, trial: TRIAL },
};

const SCHEDULE_REF = {
  _id: FIXTURE_SCHEDULE_A._id,
  dayOfWeek: FIXTURE_SCHEDULE_A.dayOfWeek,
  startTime: FIXTURE_SCHEDULE_A.startTime,
  endTime: FIXTURE_SCHEDULE_A.endTime,
};

// session-1 is the class the trial is already in.
const SESSIONS: GroupClassSessionWithSchedule[] = [
  { _id: 'session-1', date: '2026-11-04T00:00:00.000Z', scheduleId: SCHEDULE_REF },
  { _id: 'session-2', date: '2026-11-11T00:00:00.000Z', scheduleId: SCHEDULE_REF },
];

function studentsRule(students: () => Student[]): MockRule {
  return {
    method: 'GET',
    path: '/students/mine',
    handler: (route) => json<MyStudentsResponse>(route, 200, { students: students() }),
  };
}

test.describe('trial cancel and reschedule', () => {
  test('cancelling from the dashboard deletes that trial, and the child is offered a new trial', async ({ page }) => {
    let cancelled = false;
    let deleteBody: string | null = 'not sent';
    const overrides: MockRule[] = [
      studentsRule(() => [
        cancelled
          ? { ...FIXTURE_STUDENT, enrollment: { status: 'not_enrolled', canBookTrial: true, schedule: null, trial: null } }
          : STUDENT_WITH_TRIAL,
      ]),
      {
        method: 'DELETE',
        path: '/trial-classes/:id',
        handler: (route, { params }) => {
          expect(params.id).toBe('trial-1');
          deleteBody = route.request().postData();
          cancelled = true;
          return json<SuccessResponse>(route, 200, { success: true });
        },
      },
    ];
    await page.clock.setFixedTime(NOW);
    await loginAs(page, 'parent', overrides);
    await page.goto('/parent/dashboard');

    await expect(page.getByText('Trial class — Wed, Nov 4 · 4:00 PM–5:00 PM')).toBeVisible();
    await expectNoBlockingA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Cancel trial' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel Trial' });
    await expect(dialog).toContainText("Cancel Test's free trial on Wed, Nov 4 · 4:00 PM–5:00 PM?");
    await dialog.getByRole('button', { name: 'Cancel Trial' }).click();

    // The household reloaded: the server now offers this child a new trial.
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: /book a free trial/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel trial' })).toHaveCount(0);
    expect(deleteBody).toBeNull();
  });

  test('rescheduling from the dashboard opens the wizard for that child and moves the trial to the chosen class', async ({ page }) => {
    let patchBody: unknown = 'not sent';
    const overrides: MockRule[] = [
      studentsRule(() => [STUDENT_WITH_TRIAL]),
      {
        method: 'GET',
        path: '/group-class-sessions/by-class/:classId',
        handler: (route) => json<GroupClassSessionsByClassResponse>(route, 200, { sessions: SESSIONS }),
      },
      {
        method: 'PATCH',
        path: '/trial-classes/:id',
        handler: (route, { params }) => {
          expect(params.id).toBe('trial-1');
          patchBody = route.request().postDataJSON();
          return json<TrialClassResponse>(route, 200, {
            trialClass: {
              _id: 'trial-1',
              studentId: { _id: FIXTURE_STUDENT._id, firstName: FIXTURE_STUDENT.firstName, lastName: FIXTURE_STUDENT.lastName },
              sessionId: { _id: 'session-2', date: '2026-11-11T00:00:00.000Z' },
            },
          });
        },
      },
    ];
    await page.clock.setFixedTime(NOW);
    await loginAs(page, 'parent', overrides);
    await page.goto('/parent/dashboard');

    await page.getByRole('link', { name: 'Reschedule trial' }).click();

    await expect(page).toHaveURL(/\/parent\/book-trial\?reschedule=student-1$/);
    await expect(page.getByRole('heading', { name: 'Reschedule Trial' })).toBeVisible();
    const childCard = page.getByRole('radio', { name: /test child/i });
    await expect(childCard).toHaveAttribute('aria-checked', 'true');
    await expect(childCard).toContainText('Currently Wed, Nov 4 · 4:00 PM–5:00 PM');

    await page.getByLabel('Level').selectOption(FIXTURE_LEVEL_A._id);

    // The class the trial is already in is not offered.
    const sessionGroup = page.getByRole('radiogroup', { name: 'Select a session' });
    await expect(sessionGroup.getByRole('radio')).toHaveCount(1);
    await sessionGroup.getByRole('radio', { name: /Wed, Nov 11/ }).click();
    await expect(sessionGroup.getByRole('radio', { name: /Wed, Nov 11/ })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Reschedule Trial' }).click();

    await expect(page.getByText('Trial class rescheduled!')).toBeVisible();
    expect(patchBody).toEqual({ sessionId: 'session-2' });
  });

  test('a trial the server says can no longer change shows no actions, and a stale reschedule link explains why', async ({ page }) => {
    const locked: Student = {
      ...STUDENT_WITH_TRIAL,
      enrollment: { ...STUDENT_WITH_TRIAL.enrollment, trial: { ...TRIAL, canChange: false } },
    };
    await page.clock.setFixedTime(NOW);
    await loginAs(page, 'parent', [studentsRule(() => [locked])]);
    await page.goto('/parent/dashboard');

    await expect(page.getByText('Trial class — Wed, Nov 4 · 4:00 PM–5:00 PM')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reschedule trial' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel trial' })).toHaveCount(0);

    await page.goto('/parent/book-trial?reschedule=student-1');

    await expect(page.getByText(/this trial can no longer be rescheduled/i)).toBeVisible();
    await expect(page.getByLabel('Level')).toHaveCount(0);
  });
});
