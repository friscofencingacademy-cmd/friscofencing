// Domain types — typed against the REAL backend responses (see the
// corresponding model/controller in backend/src/models|controllers), not
// guesses. Populated variants exist alongside the raw (ObjectId-string)
// shape only where the backend actually returns populated documents for
// that specific endpoint (see the comment on each populated type).

export type Role = 'student' | 'parent' | 'coach' | 'admin' | 'superadmin';
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export interface AuthUser {
  _id: string;
  role: Role;
  firstName: string;
  lastName: string;
  email?: string;
  parentId?: string;
  skillLevel?: SkillLevel;
}

export interface Location {
  _id: string;
  name: string;
  address: string;
  timezone: string;
}

export interface Level {
  _id: string;
  name: string;
  order: number;
}

export interface GroupClass {
  _id: string;
  name: string;
  levelId: string;
  locationId: string;
  capacity: number;
}

export interface GroupClassSchedule {
  _id: string;
  classId: string;
  coachId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  students: string[];
}

// GET /locations/public — no auth, no `_id` (see location.service.js's
// listPublic).
export interface PublicLocation {
  name: string;
  address: string;
  timezone: string;
}

// GET /levels/public — no auth. Excludes any level with no configured
// Price rather than showing a missing/invented fee (see level.service.js's
// listPublic).
export interface PublicLevel {
  name: string;
  order: number;
  monthlyFee: number;
}

// GET /group-class-schedules/public — no auth, no ids/roster; `availability`
// is a server-derived 'open' | 'full' string only (see
// groupClassSchedule.service.js's listPublic/computeAvailability).
export interface PublicGroupClassSchedule {
  className: string;
  levelName: string;
  locationName: string;
  coachName: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  availability: 'open' | 'full';
}

export interface SessionStudentEntry {
  studentId: string;
  isPresent: boolean;
}

export interface GroupClassSession {
  _id: string;
  scheduleId: string;
  date: string;
  students: SessionStudentEntry[];
}

// GET /group-class-sessions/:id (attendance page) populates each entry's
// studentId with { _id, firstName, lastName }.
export interface PopulatedSessionStudentEntry {
  studentId: {
    _id: string;
    firstName: string;
    lastName: string;
  };
  isPresent: boolean;
}

export interface GroupClassSessionDetail {
  _id: string;
  date: string;
  students: PopulatedSessionStudentEntry[];
}

// GET /group-class-sessions/by-class/:classId — trial booking's session
// picker. scheduleId is populated with ONLY the display fields (never the
// roster or coachId — a parent browsing trial dates must never see another
// family's child names).
export interface GroupClassSessionWithSchedule {
  _id: string;
  date: string;
  scheduleId: {
    _id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  };
}

export interface Price {
  _id: string;
  levelId: string;
  monthlyFee: number;
}

export interface Student {
  _id: string;
  firstName: string;
  lastName: string;
  skillLevel?: SkillLevel;
}

export interface Coach {
  _id: string;
  firstName: string;
  lastName: string;
}

// GET /trial-classes/mine and the POST /trial-classes response both populate
// studentId ({ firstName, lastName }) and sessionId ({ date }) —
// trialClass.service.js's populateTrialClass.
export interface TrialClass {
  _id: string;
  studentId: { _id: string; firstName: string; lastName: string };
  sessionId: { _id: string; date: string };
}

export type RegistrationStatus = 'active' | 'cancelled';

export interface Registration {
  _id: string;
  studentId: string;
  scheduleId: string;
  status: RegistrationStatus;
}

export type SubscriptionStatus = 'active' | 'cancelled';

// GET /registrations/mine (registration.service.js's listMine) populates
// studentId ({ firstName, lastName }) and scheduleId (the full schedule doc).
export interface Subscription {
  _id: string;
  studentId: { _id: string; firstName: string; lastName: string };
  scheduleId: GroupClassSchedule;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart?: string;
  currentPeriodEnd: string;
  nextBillingDate: string;
  lastChargeAmount: number | null;
  lastSiblingDiscountApplied?: boolean;
}

export interface PaymentMethodInfo {
  _id: string;
  cardBrand: string;
  cardLast4: string;
  cardExpMonth: number;
  cardExpYear: number;
}

export interface RegistrationCreateResponse {
  registration: Registration;
  subscription: Subscription;
  chargeAmount: number;
  paymentIntentStatus: string;
  siblingDiscountApplied?: boolean;
  siblingDiscountAmount?: number;
}

// ── Admin Group Class Subscriptions (ckq-parity plan, Phase 3) ────────────
// Typed against subscription.service.js's populate chain
// (populateSubscriptionQuery): studentId/parentId -> firstName/lastName/
// email; scheduleId -> classId -> levelId/locationId, and coachId.

export interface AdminSubscriptionPersonRef {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface AdminSubscriptionClassRef {
  _id: string;
  name: string;
  levelId: Level;
  locationId: Location;
  capacity: number;
}

export interface AdminSubscriptionScheduleRef {
  _id: string;
  classId: AdminSubscriptionClassRef;
  coachId: AdminSubscriptionPersonRef;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  students: string[];
}

export interface AdminSubscriptionRow {
  _id: string;
  studentId: AdminSubscriptionPersonRef;
  parentId: AdminSubscriptionPersonRef;
  scheduleId: AdminSubscriptionScheduleRef;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart?: string;
  currentPeriodEnd: string;
  nextBillingDate: string;
  lastChargeAmount: number | null;
  lastSiblingDiscountApplied?: boolean;
}

export interface AdminSubscriptionListResponse {
  subscriptions: AdminSubscriptionRow[];
  total: number;
  totalPages: number;
  currentPage: number;
}

// ── Private class flow (ckq-parity plan, Phase 4) ─────────────────────────

export type PrivateEnrollmentStatus = 'active' | 'cancelled';
export type PrivateAttendanceStatus = 'scheduled' | 'attended' | 'missed';
export type PrivateChargeStatus = 'pending' | 'completed' | 'failed';

// GET /coach-contracts populates coachId -> {firstName,lastName,email}.
export interface CoachContract {
  _id: string;
  coachId: AdminSubscriptionPersonRef;
  studentBillingRate: number;
  coachCompensationRate: number;
  sessionDurationMinutes: number;
  effectiveFrom: string;
  isActive: boolean;
  notes?: string;
}

// GET /private-class-schedules (admin) / /mine (coach) populate coachId and
// studentId with {firstName,lastName[,email]}. The raw (unauthenticated
// create) shape uses plain id strings instead — PrivateClassScheduleRow
// covers both by making the populated fields a union of ref-or-id.
export interface PrivateClassScheduleRow {
  _id: string;
  coachId: AdminSubscriptionPersonRef | string;
  dayOfWeek: number;
  startTime: string;
  durationMinutes: number;
  studentId: { _id: string; firstName: string; lastName: string } | string | null;
  enrollmentId: string | null;
  isActive: boolean;
}

// GET /private-class-schedules/public — no auth, no student/parent data.
export interface PublicPrivateClassSlot {
  scheduleId: string;
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  displayTime: string;
  durationMinutes: number;
  sessionPrice: number;
  hourlyRate: number;
  firstSessionDate: string;
}

export interface PublicPrivateClassCoach {
  coachId: string;
  coachName: string;
  slots: PublicPrivateClassSlot[];
}

export interface PrivateClassEnrollmentRow {
  _id: string;
  studentId: { _id: string; firstName: string; lastName: string };
  parentId: AdminSubscriptionPersonRef;
  coachId: AdminSubscriptionPersonRef;
  coachContractId: string;
  agreedHourlyRate: number;
  status: PrivateEnrollmentStatus;
  endDate: string | null;
}

export interface PrivateClassChargeRow {
  _id: string;
  sessionId: string;
  enrollmentId: string;
  parentId: string;
  studentId: string;
  amount: number;
  status: PrivateChargeStatus;
  stripePaymentIntentId: string | null;
  attempt: number;
  failureMessage: string | null;
  paidAt: string | null;
  createdAt: string;
}

// POST /private-class-enrollments response.
export interface PrivateEnrollmentCreateResponse {
  enrollment: PrivateClassEnrollmentRow;
  schedule: PrivateClassScheduleRow;
  sessionPrice: number;
  firstSessionDate: string;
}

// GET /private-class-enrollments/mine response entry.
export interface MyPrivateEnrollmentEntry {
  enrollment: PrivateClassEnrollmentRow;
  slot: PrivateClassScheduleRow | null;
  charges: PrivateClassChargeRow[];
}

// GET /private-class-sessions/mine populates studentId + parentId, and adds
// a backend-computed sessionPrice (null if it can't be resolved) — see
// privateClassSession.service.js's listMine.
export interface PrivateClassSessionRow {
  _id: string;
  scheduleId: string;
  enrollmentId: string;
  coachId: string;
  studentId: { _id: string; firstName: string; lastName: string };
  parentId: { _id: string; firstName: string; lastName: string };
  startDate: string;
  endDate: string;
  attendance: PrivateAttendanceStatus;
  markedBy: string | null;
  markedAt: string | null;
  sessionPrice: number | null;
}

// ── Spotlights (public-site plan, GAP-2) ──────────────────────────────────

export type SpotlightType = 'coach' | 'student';

export interface Spotlight {
  _id: string;
  type: SpotlightType;
  name: string;
  title?: string;
  body?: string;
  bullets: string[];
  imageUrl?: string;
  isPublished: boolean;
  order: number;
}

// GET /spotlights/public?type=coach|student — no auth, published only,
// verbatim strings (see spotlight.service.js's listPublic).
export interface PublicSpotlight {
  name: string;
  title?: string;
  body?: string;
  bullets: string[];
  imageUrl?: string;
}

// PATCH .../attendance and POST .../retry-charge share this response shape.
export interface PrivateAttendanceResult {
  session: PrivateClassSessionRow;
  charged: boolean;
  chargeStatus?: PrivateChargeStatus;
  reason?: string;
  charge: PrivateClassChargeRow | null;
}
