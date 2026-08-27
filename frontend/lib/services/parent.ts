import api from '../api';
import type {
  PaymentMethodInfo,
  RegistrationCreateResponse,
  RegistrationPricePreview,
  SkillLevel,
  Student,
  Subscription,
  TrialClass,
} from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// ── Students (children) ─────────────────────────────────────────────────

export async function fetchMyStudents(): Promise<Student[]> {
  const res = await api.get<{ students: Student[] }>('/students/mine');
  return res.data.students;
}

export async function createStudent(data: {
  firstName: string;
  lastName: string;
  skillLevel: SkillLevel;
}): Promise<MutationResult<Student>> {
  try {
    const res = await api.post<{ student: Student }>('/students', data);
    return { status: 'success', data: res.data.student };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to add child.') };
  }
}

// ── Trial classes ────────────────────────────────────────────────────────

export async function fetchMyTrialClasses(): Promise<TrialClass[]> {
  const res = await api.get<{ trialClasses: TrialClass[] }>('/trial-classes/mine');
  return res.data.trialClasses;
}

export async function bookTrialClass(data: {
  studentId: string;
  sessionId: string;
}): Promise<MutationResult<TrialClass>> {
  try {
    const res = await api.post<{ trialClass: TrialClass }>('/trial-classes', data);
    return { status: 'success', data: res.data.trialClass };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to book trial class. Please try again.') };
  }
}

// ── Registrations / subscriptions ───────────────────────────────────────

export async function fetchMySubscriptions(): Promise<Subscription[]> {
  const res = await api.get<{ subscriptions: Subscription[] }>('/registrations/mine');
  return res.data.subscriptions;
}

export async function createRegistration(data: {
  studentId: string;
  scheduleId: string;
  startDate: string;
}): Promise<MutationResult<RegistrationCreateResponse>> {
  try {
    const res = await api.post<RegistrationCreateResponse>('/registrations', data);
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to register. Please try again.') };
  }
}

// Read-only — a query (throws on failure), not a mutation. A failed
// preview is meant to be caught locally and swallowed by the caller (it's a
// non-critical estimate; the real charge is always correctly computed
// server-side at submit time regardless), never surfaced as a step error.
export async function fetchRegistrationPricePreview(data: {
  studentId: string;
  scheduleId: string;
  startDate: string;
}): Promise<RegistrationPricePreview> {
  const res = await api.get<RegistrationPricePreview>('/registrations/preview', { params: data });
  return res.data;
}

export async function cancelSubscription(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.post(`/subscriptions/${id}/cancel`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to cancel. Please try again.') };
  }
}

// ── Payment method ───────────────────────────────────────────────────────

export async function fetchMyPaymentMethod(): Promise<PaymentMethodInfo | null> {
  const res = await api.get<{ paymentMethod: PaymentMethodInfo | null }>('/payment-methods/mine');
  return res.data.paymentMethod;
}

export async function savePaymentMethod(
  stripePaymentMethodId: string
): Promise<MutationResult<PaymentMethodInfo>> {
  try {
    const res = await api.post<{ paymentMethod: PaymentMethodInfo }>('/payment-methods', {
      stripePaymentMethodId,
    });
    return { status: 'success', data: res.data.paymentMethod };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to save card. Please try again.') };
  }
}
