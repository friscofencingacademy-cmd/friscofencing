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
