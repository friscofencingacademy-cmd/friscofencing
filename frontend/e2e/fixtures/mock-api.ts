import type { Page, Route } from '@playwright/test';

// Every backend call this E2E suite makes goes through here — see
// docs/plans/e2e-testing-plan.md's D2. No real backend, no real database:
// each spec gets a sensible, non-empty default response for every endpoint
// the app actually calls (enumerated by reading the real service files, not
// guessed), and overrides only what that spec cares about asserting on.
//
// Known, accepted limitation (D2/§0 of the plan): these are hand-written
// snapshots of the API's current shape. If the real backend's response
// shape changes, this suite keeps passing — that class of drift stays
// audit/'s job, which talks to the real API.

export interface MockRule {
  method: string;
  // Path with the leading /api/v1 stripped, e.g. '/levels', '/levels/:id'.
  // ':name' segments are captured and passed to the handler as `params`.
  path: string;
  handler: (route: Route, ctx: { params: Record<string, string>; url: URL }) => Promise<void> | void;
}

function pathToRegExp(path: string): { regexp: RegExp; keys: string[] } {
  const keys: string[] = [];
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regexp: new RegExp(`^${pattern}$`), keys };
}

export function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

// ── Fixture data — shapes verified against the real service files and
// model fields this session, not guessed. ──────────────────────────────────

export const FIXTURE_LEVEL_A = { _id: 'level-a', name: 'Fencing Foundation', order: 1 };
export const FIXTURE_LEVEL_B = { _id: 'level-b', name: 'Intermediate', order: 2 };
export const FIXTURE_LOCATION = { _id: 'location-1', name: 'Frisco Main', address: '123 Main St, Frisco, TX' };
export const FIXTURE_GROUP_CLASS_A = {
  _id: 'class-a',
  name: 'Fencing Foundation',
  levelId: FIXTURE_LEVEL_A._id,
  locationId: FIXTURE_LOCATION._id,
  capacity: 20,
};
export const FIXTURE_PRICE_A = { _id: 'price-a', levelId: FIXTURE_LEVEL_A._id, monthlyFee: 100 };
export const FIXTURE_SCHEDULE_A = {
  _id: 'schedule-a',
  classId: FIXTURE_GROUP_CLASS_A._id,
  coachId: 'coach-1',
  dayOfWeek: 2,
  startTime: '16:00',
  endTime: '17:00',
};
export const FIXTURE_STUDENT = { _id: 'student-1', firstName: 'Test', lastName: 'Child', role: 'student' as const };
export const FIXTURE_PAYMENT_METHOD = { cardBrand: 'visa', cardLast4: '4242' };

const DEFAULT_RULES: MockRule[] = [
  // Session — logged out by default; loginAs() in fixtures/auth.ts
  // prepends an override that wins over this one.
  { method: 'GET', path: '/auth/me', handler: (route) => json(route, 401, { message: 'Not authenticated' }) },

  // Public site
  { method: 'GET', path: '/levels/public', handler: (route) => json(route, 200, { levels: [FIXTURE_LEVEL_A, FIXTURE_LEVEL_B] }) },
  { method: 'GET', path: '/locations/public', handler: (route) => json(route, 200, { locations: [FIXTURE_LOCATION] }) },
  {
    method: 'GET',
    path: '/spotlights/public',
    // Empty by default for both coach/student spotlights — the home page
    // and /coaches both render a real, valid "nothing published yet" state
    // on an empty array, which is itself worth exercising by default.
    handler: (route) => json(route, 200, { spotlights: [] }),
  },
  {
    method: 'GET',
    path: '/group-class-schedules/public',
    handler: (route) =>
      json(route, 200, {
        schedules: [
          {
            ...FIXTURE_SCHEDULE_A,
            levelName: FIXTURE_LEVEL_A.name,
            locationName: FIXTURE_LOCATION.name,
          },
        ],
      }),
  },

  // Admin — catalog data
  { method: 'GET', path: '/group-classes', handler: (route) => json(route, 200, { groupClasses: [FIXTURE_GROUP_CLASS_A] }) },
  { method: 'GET', path: '/group-class-schedules', handler: (route) => json(route, 200, { schedules: [FIXTURE_SCHEDULE_A] }) },
  { method: 'GET', path: '/group-class-schedules/mine', handler: (route) => json(route, 200, { schedules: [FIXTURE_SCHEDULE_A] }) },
  { method: 'GET', path: '/locations', handler: (route) => json(route, 200, { locations: [FIXTURE_LOCATION] }) },
  { method: 'GET', path: '/levels', handler: (route) => json(route, 200, { levels: [FIXTURE_LEVEL_A, FIXTURE_LEVEL_B] }) },
  { method: 'POST', path: '/levels', handler: (route) => json(route, 201, { level: { _id: 'level-new', name: 'New Level', order: 3 } }) },
  { method: 'PUT', path: '/levels/:id', handler: (route, { params }) => json(route, 200, { level: { _id: params.id, name: 'Updated Level', order: 1 } }) },
  { method: 'DELETE', path: '/levels/:id', handler: (route) => route.fulfill({ status: 204 }) },
  { method: 'GET', path: '/prices', handler: (route) => json(route, 200, { prices: [FIXTURE_PRICE_A] }) },

  // Parent portal
  { method: 'GET', path: '/students/mine', handler: (route) => json(route, 200, { students: [FIXTURE_STUDENT] }) },
  { method: 'GET', path: '/trial-classes/mine', handler: (route) => json(route, 200, { trialClasses: [] }) },
  { method: 'GET', path: '/registrations/mine', handler: (route) => json(route, 200, { subscriptions: [] }) },
  { method: 'GET', path: '/payment-methods/mine', handler: (route) => json(route, 200, { paymentMethod: FIXTURE_PAYMENT_METHOD }) },
  { method: 'GET', path: '/private-class-enrollments/mine', handler: (route) => json(route, 200, { enrollments: [] }) },

  // Register wizard
  {
    method: 'GET',
    path: '/group-class-sessions/by-class/:classId',
    handler: (route) =>
      json(route, 200, {
        sessions: [
          {
            _id: 'session-1',
            scheduleId: FIXTURE_SCHEDULE_A,
            date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      }),
  },
  {
    method: 'GET',
    path: '/registrations/preview',
    handler: (route) =>
      json(route, 200, {
        chargeAmount: 100,
        totalChargeAmount: 100,
        siblingDiscountApplied: false,
        siblingDiscountAmount: 0,
        siblingDiscountReason: null,
        registrationFeeCharged: 0,
        registrationFeeWaived: true,
        registrationFeeReason: 'Waived',
        prorated: false,
        totalClassDays: null,
        remainingClassDays: null,
        dailyRate: null,
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        // Family Scorecard checkout quote panel (docs/plans/wordpress-ui-
        // alignment-plan.md, Phase 3) — 0 here rather than a real waived
        // amount: no existing e2e spec asserts on the "You Save" line, and
        // this default fixture doesn't track what the fee would have been.
        savings: { siblingDiscount: 0, registrationFeeWaived: 0, total: 0 },
      }),
  },
  {
    method: 'POST',
    path: '/registrations',
    handler: (route) =>
      json(route, 201, {
        chargeAmount: 100,
        totalChargeAmount: 100,
        paymentStatus: 'completed',
        siblingDiscountApplied: false,
        siblingDiscountAmount: 0,
        siblingDiscountReason: null,
        registrationFeeCharged: 0,
        registrationFeeWaived: true,
        registrationFeeReason: 'Waived',
        prorated: false,
        totalClassDays: null,
        remainingClassDays: null,
        dailyRate: null,
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        savings: { siblingDiscount: 0, registrationFeeWaived: 0, total: 0 },
      }),
  },

  // Coach attendance
  {
    method: 'GET',
    path: '/group-class-sessions/:id',
    handler: (route, { params }) =>
      json(route, 200, {
        session: {
          _id: params.id,
          date: new Date().toISOString(),
          students: [{ studentId: FIXTURE_STUDENT, isPresent: false }],
        },
      }),
  },
  { method: 'PATCH', path: '/group-class-sessions/:id/attendance', handler: (route) => json(route, 200, { success: true }) },
];

/**
 * Installs the shared default mock registry for `**\/api/v1/**`, with
 * `overrides` checked first (last-registered-wins semantics don't apply
 * here — this is an explicit priority list, not Playwright's route stack).
 * An unmocked endpoint fails loudly (501 + console warning) rather than
 * silently 200ing with `{}` — a spec that hits one should add a rule, not
 * quietly render an empty state that looks like it passed for the wrong
 * reason.
 */
export async function mockApi(page: Page, overrides: MockRule[] = []) {
  const rules = [...overrides, ...DEFAULT_RULES];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiIndex = url.pathname.indexOf('/api/v1');
    const pathname = apiIndex >= 0 ? url.pathname.slice(apiIndex + '/api/v1'.length) || '/' : url.pathname;
    const method = request.method();

    for (const rule of rules) {
      if (rule.method !== method) continue;
      const { regexp, keys } = pathToRegExp(rule.path);
      const match = pathname.match(regexp);
      if (!match) continue;

      const params: Record<string, string> = {};
      keys.forEach((key, i) => {
        params[key] = match[i + 1];
      });

      await rule.handler(route, { params, url });
      return;
    }

    console.warn(`[mock-api] Unmocked request — add a MockRule: ${method} ${pathname}`);
    await json(route, 501, { message: `Unmocked in E2E suite: ${method} ${pathname}` });
  });
}
