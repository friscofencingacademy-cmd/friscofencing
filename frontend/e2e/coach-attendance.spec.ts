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
});
