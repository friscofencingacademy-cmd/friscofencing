import type { Page } from '@playwright/test';

import { mockApi, json, type MockRule } from './mock-api';

export type Role = 'student' | 'parent' | 'coach' | 'admin' | 'superadmin';

export const ROLE_LANDING_PATH: Record<Role, string> = {
  admin: '/admin/dashboard',
  superadmin: '/admin/dashboard',
  coach: '/coach/schedules',
  parent: '/parent/dashboard',
  student: '/',
};

function fakeUser(role: Role) {
  return {
    _id: `user-${role}`,
    role,
    firstName: 'Test',
    lastName: role === 'parent' ? 'Parent' : role[0].toUpperCase() + role.slice(1),
    email: `${role}@example.com`,
  };
}

/**
 * Fast path for every spec that just needs to already be logged in as a
 * given role — does the same route-mock/cookie dance login.spec.ts proves
 * out for real, without re-typing a password into the form every time
 * (docs/plans/e2e-testing-plan.md's D3). Installs the full default mock
 * registry too, so callers only need to layer their own scenario-specific
 * overrides on top.
 */
export async function loginAs(page: Page, role: Role, extraOverrides: MockRule[] = []) {
  const user = fakeUser(role);

  await page.context().addCookies([
    {
      name: 'accessToken',
      value: 'e2e-fake-jwt',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
    },
  ]);

  const authOverride: MockRule = {
    method: 'GET',
    path: '/auth/me',
    handler: (route) => json(route, 200, { user }),
  };

  await mockApi(page, [authOverride, ...extraOverrides]);

  return user;
}
