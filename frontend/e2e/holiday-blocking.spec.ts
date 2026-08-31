// docs/plans/holiday-blocking-plan.md — admin/superadmin manage holidays;
// parents never see a holiday date in the trial/registration pickers;
// coaches/admins can't mark attendance on one.
//
// This suite's network is fully mocked (page.route(), no real backend) —
// see fixtures/mock-api.ts's own docblock. The real holiday-filtering logic
// (listUpcomingByClass excluding a holiday-covered session) lives entirely
// server-side and is proven by the backend's own Jest suite
// (groupClassSession.service.test.js). What THIS layer proves is the real
// DOM/browser behavior on either side of that contract: the admin CRUD page
// actually creates/lists/deletes a holiday through real clicks, and the
// parent/coach pages render correctly for whatever the backend hands them —
// a session list that already excludes a blocked date, or a session
// annotated isHoliday. A mock that simply omits the blocked date is the
// faithful stand-in for "the backend filtered it out."

import { test, expect } from '@playwright/test';

import { mockApi, json, FIXTURE_GROUP_CLASS_A, FIXTURE_LEVEL_A, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';

function sessionsByClassFixture(sessions: { _id: string; date: string }[]) {
  return {
    method: 'GET',
    path: `/group-class-sessions/by-class/${FIXTURE_GROUP_CLASS_A._id}`,
    handler: (route) =>
      json(route, 200, {
        sessions: sessions.map((s) => ({
          _id: s._id,
          scheduleId: { _id: 'schedule-a', dayOfWeek: 2, startTime: '16:00', endTime: '17:00' },
          date: s.date,
        })),
      }),
  } satisfies MockRule;
}

test.describe('holiday blocking (docs/plans/holiday-blocking-plan.md)', () => {
  test('admin: creates a holiday, sees it listed, and deletes it', async ({ page }) => {
    let holidays: { _id: string; name: string; startDate: string; endDate: string }[] = [];

    const overrides: MockRule[] = [
      { method: 'GET', path: '/holidays', handler: (route) => json(route, 200, { holidays }) },
      {
        method: 'POST',
        path: '/holidays',
        handler: (route) => {
          const created = { _id: 'holiday-new', name: 'Winter Break', startDate: '2026-12-24', endDate: '2026-12-26' };
          holidays = [...holidays, created];
          return json(route, 201, { holiday: created });
        },
      },
      {
        method: 'DELETE',
        path: '/holidays/:id',
        handler: (route, { params }) => {
          holidays = holidays.filter((h) => h._id !== params.id);
          return json(route, 200, { success: true });
        },
      },
    ];
    await loginAs(page, 'admin', overrides);

    await page.goto('/admin/holidays');
    await expect(page.getByText('No holidays found')).toBeVisible();

    await page.getByRole('button', { name: /add holiday/i }).click();
    await page.getByLabel('Name').fill('Winter Break');
    await page.getByLabel('Start Date').fill('2026-12-24');
    await page.getByLabel('End Date').fill('2026-12-26');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Winter Break')).toBeVisible();

    await page.getByRole('button', { name: 'Delete Winter Break' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Winter Break')).toHaveCount(0);
    await expect(page.getByText('No holidays found')).toBeVisible();
  });

  test('register wizard: a holiday-blocked date never appears in the start-date picker, and the remaining date still registers', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2025-03-05T12:00:00.000Z'));

    // The backend's listUpcomingByClass would have excluded 2025-03-10 (a
    // holiday) entirely — this fixture returns only what a real backend
    // response looks like AFTER that filtering, per this file's own
    // docblock. Only one real, bookable date is offered.
    await loginAs(page, 'parent', [
      sessionsByClassFixture([{ _id: 'session-open', date: '2025-03-17T21:00:00.000Z' }]),
    ]);

    await page.goto('/parent/register');

    await page.getByRole('radio', { name: /test child/i }).click();
    await page.getByRole('radio', { name: /fencing foundation/i }).click();

    const dateGroup = page.getByRole('radiogroup', { name: 'Select a start date' });
    await expect(dateGroup).toBeVisible();
    // Exactly the one non-holiday date is offered — nothing for the blocked
    // one, proving there is no way to select it through the real UI.
    await expect(dateGroup.getByRole('radio')).toHaveCount(1);

    await dateGroup.getByRole('radio').first().click();
    await expect(page.getByText(/card on file/i)).toBeVisible();
    await page.getByRole('button', { name: /register & pay/i }).click();

    await expect(page.getByText('Registration complete!')).toBeVisible();
  });

  test('book-trial wizard: a holiday-blocked date never appears in the session picker', async ({ page }) => {
    await loginAs(page, 'parent', [
      sessionsByClassFixture([{ _id: 'session-open', date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() }]),
    ]);

    await page.goto('/parent/book-trial');

    await page.getByRole('radio', { name: /test child/i }).click();
    // Unlike the register wizard, book-trial does not auto-advance on
    // picking a child — its OrderSummary CTA reads "Continue" for step 0.
    await page.getByRole('button', { name: 'Continue' }).click();
    // Level-driven, not class-driven (a GroupClass's own name can go stale
    // relative to its Level's name) — FIXTURE_GROUP_CLASS_A.levelId points
    // at FIXTURE_LEVEL_A, so picking this level resolves to that class
    // internally.
    await page.getByLabel('Level').selectOption(FIXTURE_LEVEL_A._id);

    const sessionGroup = page.getByRole('radiogroup', { name: 'Select a session' });
    await expect(sessionGroup).toBeVisible();
    await expect(sessionGroup.getByRole('radio')).toHaveCount(1);
  });

  test('coach attendance: a holiday-date session shows a blocked alert, no checkboxes, no Save', async ({ page }) => {
    const sessionId = 'session-holiday';

    const overrides: MockRule[] = [
      {
        method: 'GET',
        path: `/group-class-sessions/${sessionId}`,
        handler: (route) =>
          json(route, 200, {
            session: {
              _id: sessionId,
              date: '2026-12-25T00:00:00.000Z',
              students: [{ studentId: { _id: 'student-1', firstName: 'Test', lastName: 'Child' }, isPresent: false }],
              isHoliday: true,
              holidayName: 'Christmas',
            },
          }),
      },
    ];
    await loginAs(page, 'coach', overrides);

    await page.goto(`/sessions/${sessionId}/attendance`);

    await expect(page.getByText(/christmas/i)).toBeVisible();
    await expect(page.getByText(/attendance is disabled/i)).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /save attendance/i })).toHaveCount(0);
  });

  test('admin sessions list: a holiday row renders a muted chip with no Mark Attendance link', async ({ page }) => {
    const scheduleId = 'schedule-a';

    const overrides: MockRule[] = [
      {
        method: 'GET',
        path: `/group-class-sessions/by-schedule/${scheduleId}`,
        handler: (route) =>
          json(route, 200, {
            sessions: [
              {
                _id: 'session-open',
                scheduleId,
                date: '2026-12-01T00:00:00.000Z',
                students: [],
                isHoliday: false,
                holidayName: null,
              },
              {
                _id: 'session-holiday',
                scheduleId,
                date: '2026-12-25T00:00:00.000Z',
                students: [],
                isHoliday: true,
                holidayName: 'Christmas',
              },
            ],
          }),
      },
    ];
    await loginAs(page, 'admin', overrides);

    await page.goto(`/admin/schedules/${scheduleId}/sessions`);

    await expect(page.getByText('Holiday — Christmas')).toBeVisible();
    // Exactly one Mark Attendance link — the holiday row renders none.
    await expect(page.getByRole('link', { name: /mark attendance/i })).toHaveCount(1);
  });
});
