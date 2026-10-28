import type {
  AdminSubscriptionRow,
  AuthUser,
  CoachPrivateAvailabilityRule,
  CoachPrivateBookingRow,
  GroupClass,
  GroupClassSchedule,
  GroupClassSession,
  GroupClassSessionDetail,
  GroupClassSessionWithSchedule,
  Holiday,
  Level,
  Location,
  PaymentHistoryRow,
  PaymentMethodInfo,
  Price,
  PrivatePurchaseEntry,
  PublicGroupClassSchedule,
  PublicLevel,
  PublicLocation,
  PublicSpotlight,
  PublicTestimonial,
  Spotlight,
  Student,
  Subscription,
  TrialClass,
} from './types';

// The response ENVELOPE of an API endpoint, named once and used by both the
// code that reads it (lib/services/*, a page) and the E2E mock that fakes it
// (e2e/fixtures/mock-api.ts, whose json<T>() requires one of these). A mock
// body that drifts from what the app reads then fails `tsc` on the PR that
// causes it (docs/plans/testing-strategy-refresh-plan.md PR B; CKQ's
// apiSuccess<T> pattern).
//
// Every endpoint the E2E layer mocks has its envelope here. Endpoints it does
// not mock keep their inline type in the service until they are next touched,
// then move here.
//
// A response whose body is a domain type itself (CalendarResponse,
// KioskState, PrivatePurchaseQuote, RegistrationPricePreview, …) stays in
// lib/types.ts — those are already named once.

/** Any error response — the backend's central error handler sends `{ message }` only. */
export interface ApiErrorResponse {
  message: string;
}

/** A response whose body the app never reads (e.g. PATCH /group-class-sessions/:id/attendance). */
export type IgnoredBodyResponse = Record<string, never>;

/** GET /auth/me, POST /auth/login, POST /auth/register */
export interface AuthUserResponse {
  user: AuthUser;
}

/** GET /levels/public */
export interface PublicLevelsResponse {
  levels: PublicLevel[];
}

/** GET /locations/public */
export interface PublicLocationsResponse {
  locations: PublicLocation[];
}

/** GET /spotlights */
export interface SpotlightsResponse {
  spotlights: Spotlight[];
}

/** POST /spotlights, PUT /spotlights/:id */
export interface SpotlightResponse {
  spotlight: Spotlight;
}

/** POST /spotlights/upload-image, POST /testimonials/upload-image — the uploaded file's public Blob URL */
export interface ImageUploadResponse {
  imageUrl: string;
}

/** GET /spotlights/public */
export interface PublicSpotlightsResponse {
  spotlights: PublicSpotlight[];
}

/** GET /testimonials/public */
export interface PublicTestimonialsResponse {
  testimonials: PublicTestimonial[];
}

/** GET /group-class-schedules/public */
export interface PublicGroupClassSchedulesResponse {
  schedules: PublicGroupClassSchedule[];
}

/** GET /locations */
export interface LocationsResponse {
  locations: Location[];
}

/** GET /levels */
export interface LevelsResponse {
  levels: Level[];
}

/** POST /levels, PUT /levels/:id */
export interface LevelResponse {
  level: Level;
}

/** GET /group-classes */
export interface GroupClassesResponse {
  groupClasses: GroupClass[];
}

/** GET /group-class-schedules, GET /group-class-schedules/mine */
export interface GroupClassSchedulesResponse {
  schedules: GroupClassSchedule[];
}

/** GET /prices */
export interface PricesResponse {
  prices: Price[];
}

/** GET /holidays */
export interface HolidaysResponse {
  holidays: Holiday[];
}

/** POST /holidays, PUT /holidays/:id */
export interface HolidayResponse {
  holiday: Holiday;
}

/** GET /group-class-sessions/by-schedule/:scheduleId */
export interface GroupClassSessionsByScheduleResponse {
  sessions: GroupClassSession[];
}

/** GET /group-class-sessions/by-class/:classId */
export interface GroupClassSessionsByClassResponse {
  sessions: GroupClassSessionWithSchedule[];
}

/** GET /group-class-sessions/:id */
export interface GroupClassSessionDetailResponse {
  session: GroupClassSessionDetail;
}

/** GET /students/mine */
export interface MyStudentsResponse {
  students: Student[];
}

/** GET /trial-classes/mine */
export interface MyTrialClassesResponse {
  trialClasses: TrialClass[];
}

/** POST /trial-classes, PATCH /trial-classes/:id */
export interface TrialClassResponse {
  trialClass: TrialClass;
}

/** DELETE /trial-classes/:id */
export interface SuccessResponse {
  success: true;
}

/** GET /registrations/mine */
export interface MySubscriptionsResponse {
  subscriptions: Subscription[];
}

/** PATCH /subscriptions/:id/schedule */
export interface AdminSubscriptionResponse {
  subscription: AdminSubscriptionRow;
}

/** GET /registrations/history (a parent's own, or ?parentId= for an admin) */
export interface PaymentHistoryResponse {
  history: PaymentHistoryRow[];
}

/** GET /payment-methods/mine */
export interface MyPaymentMethodResponse {
  paymentMethod: PaymentMethodInfo | null;
}

/** GET /private-class-enrollments/mine */
export interface MyPrivatePurchasesResponse {
  enrollments: PrivatePurchaseEntry[];
}

/** GET /private-class-schedules/mine (coach) */
export interface MyPrivateAvailabilityRulesResponse {
  schedules: CoachPrivateAvailabilityRule[];
}

/** GET /private-class-sessions/mine (coach) */
export interface MyPrivateBookingsResponse {
  sessions: CoachPrivateBookingRow[];
}
