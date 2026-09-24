import { test, expect } from '@playwright/test';

import { json, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';

// The one shared coach/admin page with a real state machine (unmarked ->
// attended/missed) that Jest already unit-tests in isolation but no real
// click-through exists for (docs/plans/e2e-testing-plan.md's D4).
test.describe('coach attendance', () => {
  test('marks a student attended and saves', async ({ page }) => {
    const sessionId = 'session-123';
    const student = { _id: 'student-1', firstName: 'Test', lastName: 'Child' };

    let savedPayload: unknown = null;

    const overrides: MockRule[] = [
      {
        method: 'GET',
        path: `/group-class-sessions/${sessionId}`,
        handler: (route) =>
          json(route, 200, {
            session: { _id: sessionId, date: new Date().toISOString(), students: [{ studentId: student, isPresent: false }] },
          }),
      },
      {
        method: 'PATCH',
        path: `/group-class-sessions/${sessionId}/attendance`,
        handler: (route) => {
          savedPayload = JSON.parse(route.request().postData() ?? '{}');
          return json(route, 200, { success: true });
        },
      },
    ];
    await loginAs(page, 'coach', overrides);

    await page.goto(`/sessions/${sessionId}/attendance`);

    await expect(page.getByText('Mark Attendance')).toBeVisible();
    const studentCheckbox = page.getByLabel(/test child/i);
    await expect(studentCheckbox).not.toBeChecked();
    await studentCheckbox.check();

    await page.getByRole('button', { name: /save attendance/i }).click();
    await expect(page.getByText('Attendance saved.')).toBeVisible();

    expect(savedPayload).toEqual({ students: [{ studentId: student._id, isPresent: true }] });
  });

  // docs/plans/duplication-cleanup-plan.md A-D1 — attendance opens on the
  // session's own day. The backend annotates `attendanceOpen: false` for a
  // session whose day hasn't started; the page renders a blocked state with
  // no roster and no Save button. (The test above sends no such field and so
  // stays open — absent means open.)
  test('shows a blocked state, with no roster or Save button, for a session whose day has not started', async ({
    page,
  }) => {
    const sessionId = 'session-future';
    const student = { _id: 'student-1', firstName: 'Test', lastName: 'Child' };

    const overrides: MockRule[] = [
      {
        method: 'GET',
        path: `/group-class-sessions/${sessionId}`,
        handler: (route) =>
          json(route, 200, {
            session: {
              _id: sessionId,
              date: '2026-12-02T00:00:00.000Z',
              students: [{ studentId: student, isPresent: false }],
              attendanceOpen: false,
            },
          }),
      },
    ];
    await loginAs(page, 'coach', overrides);

    await page.goto(`/sessions/${sessionId}/attendance`);

    await expect(page.getByText(/attendance opens on dec 2, 2026/i)).toBeVisible();
    await expect(page.getByLabel(/test child/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /save attendance/i })).toHaveCount(0);
  });
});
