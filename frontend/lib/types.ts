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
  // Parent-only in practice, collected at signup (docs/plans/trial-
  // registration-required-fields-plan.md §1.2).
  phone?: string;
  parentId?: string;
  skillLevel?: SkillLevel;
  // Student-only in practice, same as skillLevel above — GET /users mixes
  // every role into one list (admin/users), so this shared shape carries
  // every role-specific optional field rather than a role-narrowed union.
  // See Student's own dateOfBirth/age fields for the full doc comment.
  dateOfBirth?: string;
  age?: number | null;
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

// GET /group-class-schedules/public — no auth, no ids/roster. `availability`
// is a server-derived 'open' | 'full' string, present only in schedule-based
// mode; premium (the live default) omits it entirely since one schedule's
// roster filling up doesn't mean the level has no room (see
// groupClassSchedule.service.js's listPublic/computeAvailability).
export interface PublicGroupClassSchedule {
  className: string;
  levelName: string;
  locationName: string;
  coachName: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  availability?: 'open' | 'full';
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
  // Additive (docs/plans/premium-registration-and-attendance-plan.md §5) —
  // lets the attendance page offer "Evaluate" only for a trial student
  // marked present.
  classType?: 'regular' | 'trial';
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
  // Collected on Add Child (docs/plans/trial-registration-required-fields-
  // plan.md §1.3) — an ISO date string ("YYYY-MM-DD"), absent on a child
  // created before this field existed.
  dateOfBirth?: string;
  // Backend-computed from dateOfBirth, fresh on every read (§1.5) — never
  // derived on the frontend. null (not 0) when there's no dateOfBirth on
  // file, or absent on a response shape that doesn't compute it.
  age?: number | null;
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

// Registration is a payment LEDGER row now, not an enrollment record —
// docs/plans/registration-ledger-plan.md. `Subscription` (below) is the
// enrollment fact; this is the money fact: one immutable row per charge
// cycle, attempted or succeeded, returned from POST /registrations as the
// `registration` key of RegistrationCreateResponse.
export type RegistrationEventType = 'initial' | 'renewal' | 'legacy';
export type RegistrationStatus = 'pending' | 'completed' | 'failed';

export interface RegistrationBreakdown {
  monthlyFee: number;
  prorated: boolean;
  proratedAmount: number | null;
  siblingDiscountApplied: boolean;
  siblingDiscountAmount: number;
  registrationFeeCharged: number;
}

export interface Registration {
  _id: string;
  subscriptionId: string;
  studentId: string;
  scheduleId: string;
  parentId: string;
  eventType: RegistrationEventType;
  status: RegistrationStatus;
  amount: number;
  breakdown: RegistrationBreakdown;
  periodStart: string;
  periodEnd: string;
  stripePaymentIntentId: string | null;
  failureMessage: string | null;
  attempt: number;
  paidAt: string | null;
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
  // One flat fee, attend any scheduled session of the level (docs/plans/
  // premium-registration-and-attendance-plan.md). Optional only because
  // some older fixtures predate the field, not because it's ever actually
  // absent on a real Subscription doc.
  isPremium?: boolean;
  // One-time registration fee actually charged at creation — captured once,
  // never touched by a later admin change to the fee or by renewals. 0 for
  // most subscriptions today (no fee configured), never null/undefined.
  registrationFeeCharged?: number;
  // Permanent audit record of whether THIS subscription's first charge was
  // prorated — captured once at creation, never touched again (a prorated
  // first period is always followed by full-price, full-month renewals).
  firstChargeProrated?: boolean;
  // Live sibling-discount snapshot, computed fresh on every GET (never a
  // stored field) — see registration.service.js's listMine. Distinct from
  // lastChargeAmount/lastSiblingDiscountApplied above, which only reflect
  // what happened at THIS subscription's own last charge and can go stale
  // the moment a sibling's situation changes. Present only for an active
  // subscription whose current fee could be resolved; absent (not null) for
  // a cancelled subscription or one whose pricing can no longer be found.
  currentCharge?: {
    amount: number;
    siblingDiscountApplied: boolean;
    siblingDiscountAmount: number;
    reason: string | null;
  };
}

export interface PaymentMethodInfo {
  _id: string;
  cardBrand: string;
  cardLast4: string;
  cardExpMonth: number;
  cardExpYear: number;
}

export interface RegistrationCreateResponse extends ProrationInfo {
  registration: Registration;
  subscription: Subscription;
  chargeAmount: number;
  // What Stripe actually charged: chargeAmount + registrationFeeCharged.
  // chargeAmount alone stays the recurring monthly amount, unchanged
  // meaning — use this for "your card was charged" copy.
  totalChargeAmount: number;
  // 'completed' | 'pending' (docs/decisions/008-registration-create-
  // pending-first.md) — a 201 no longer means "your card was charged"
  // unconditionally: the Subscription is reserved and the registration is
  // ACCEPTED before the first charge attempt runs. 'pending' means that
  // first attempt failed and it's now retrying automatically over the next
  // few days (the same dunning a renewal failure already uses) — render a
  // distinct "we're processing your payment" state, never the success
  // screen and never an error.
  paymentStatus: 'completed' | 'pending';
  siblingDiscountApplied?: boolean;
  siblingDiscountAmount?: number;
  siblingDiscountReason?: string | null;
  registrationFeeCharged?: number;
  registrationFeeWaived?: boolean;
  registrationFeeReason?: string | null;
  // Same shape/computation as RegistrationPricePreview's savings — Family
  // Scorecard checkout quote panel (docs/plans/wordpress-ui-alignment-plan
  // .md, Phase 3), added to the real-charge response too so the
  // post-payment confirmation screen can show the same "you saved $X" line
  // the pre-payment preview did.
  savings?: RegistrationPreviewSavings;
}

// Family Scorecard checkout quote panel (docs/plans/wordpress-ui-alignment
// -plan.md, Phase 3) — server-computed so the frontend never subtracts these
// itself (Hard Rule 7). Preview-only (POST /registrations's real-charge
// response has no equivalent field): registrationFeeWaived here is the
// waived fee's dollar VALUE (0 when nothing was waived) — the only place
// that value exists at all, since registrationFeeCharged above is 0
// whenever the fee is waived, same as when no fee is configured.
export interface RegistrationPreviewSavings {
  siblingDiscount: number;
  registrationFeeWaived: number;
  total: number;
}

// GET /registrations/preview — read-only pricing/discount estimate for the
// register wizard's summary, before the parent commits to paying. Same
// fields calculateChargeAmount() computes for the real charge (see
// backend/src/services/registration.service.js's previewChargeAmount), so
// this can never structurally disagree with what actually gets charged.
export interface RegistrationPricePreview extends ProrationInfo {
  monthlyFee: number;
  chargeAmount: number;
  totalChargeAmount: number;
  siblingDiscountApplied: boolean;
  siblingDiscountAmount: number;
  siblingDiscountReason: string | null;
  registrationFeeCharged: number;
  registrationFeeWaived: boolean;
  registrationFeeReason: string | null;
  savings: RegistrationPreviewSavings;
}

// GET/PATCH /api/v1/settings — superadmin-only (setting.model.js). Singleton.
// prorationEnabled is deprecated (docs/decisions/007-calendar-month-
// billing.md) and no longer part of the API contract — proration always
// runs now.
export interface Setting {
  registrationFee: number;
  returningStudentGracePeriodMonths: number;
}

// Shared by RegistrationPricePreview and RegistrationCreateResponse —
// identical shape, same guarantee (preview can never structurally disagree
// with the real charge, docs/plans/prorated-first-month-billing-plan.md).
// totalClassDays/remainingClassDays/dailyRate are null when `prorated` is
// false; periodEnd is always present (even unprorated) so the wizard can
// always show a "renews on" date.
export interface ProrationInfo {
  prorated: boolean;
  totalClassDays: number | null;
  remainingClassDays: number | null;
  dailyRate: number | null;
  periodEnd: string;
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
  // null when the coach was deleted without a delete-guard blocking it
  // (orphaned-coach-reference-fix-plan D3) — never assume it's populated.
  coachId: AdminSubscriptionPersonRef | null;
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
  // One flat fee, attend any scheduled session of the level (docs/plans/
  // premium-registration-and-attendance-plan.md) — gates whether the admin
  // page offers Change Schedule at all.
  isPremium?: boolean;
  // One-time registration fee charged at creation, 0 if none was configured
  // at the time — see Subscription's own field for the full doc comment.
  registrationFeeCharged?: number;
  // See Subscription's own field for the full doc comment.
  firstChargeProrated?: boolean;
}

export interface AdminSubscriptionListResponse {
  subscriptions: AdminSubscriptionRow[];
  total: number;
  totalPages: number;
  currentPage: number;
}

// ── Audit runs (docs/plans/audit-system-plan.md) ──────────────────────────
// Typed against backend/src/models/auditRun.model.js exactly.

export type AuditOverallResult = 'pass' | 'fail' | 'partial';
export type AuditScenarioResult = 'pass' | 'fail' | 'skip';

export interface AuditRunScenario {
  id: string;
  name: string;
  result: AuditScenarioResult;
  note: string;
}

export interface AuditRun {
  _id: string;
  auditName: string;
  group: string | null;
  overall: AuditOverallResult;
  scenarios: AuditRunScenario[];
  summary: string;
  startedAt: string;
  finishedAt: string;
  runner: string;
  createdAt: string;
  updatedAt: string;
}

export interface LatestAuditRunsResponse {
  runs: AuditRun[];
  total: number;
}

// ── Private class flow (ckq-parity plan, Phase 4) ─────────────────────────

export type PrivateEnrollmentStatus = 'active' | 'cancelled';
export type PrivateAttendanceStatus = 'scheduled' | 'attended' | 'missed';
export type PrivateChargeStatus = 'pending' | 'completed' | 'failed';

// GET /coach-contracts populates coachId -> {firstName,lastName,email}.
export interface CoachContract {
  _id: string;
  // null when the coach was deleted without a delete-guard blocking it
  // (orphaned-coach-reference-fix-plan D3) — never assume it's populated.
  coachId: AdminSubscriptionPersonRef | null;
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
  // null when the coach was deleted without a delete-guard blocking it
  // (orphaned-coach-reference-fix-plan D3) — never assume it's populated.
  coachId: AdminSubscriptionPersonRef | string | null;
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
  // All three can be null when the referenced user was deleted without a
  // delete-guard blocking it (orphaned-coach-reference-fix-plan D3/§8a) —
  // never assume any of them is populated.
  studentId: { _id: string; firstName: string; lastName: string } | null;
  parentId: AdminSubscriptionPersonRef | null;
  coachId: AdminSubscriptionPersonRef | null;
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

// POST /evaluations (docs/plans/premium-registration-and-attendance-plan.md
// §3.10) — evaluation.service.js's populateEvaluationQuery chain.
export interface Evaluation {
  _id: string;
  studentId: { _id: string; firstName: string; lastName: string };
  coachId: { _id: string; firstName: string; lastName: string };
  groupClassSessionId: { _id: string; date: string; scheduleId: string };
  assignedLevelId: { _id: string; name: string };
  notes: string;
}
