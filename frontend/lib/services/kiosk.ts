import api from '../api';
import type { KioskSignInResult, KioskState } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// The front-desk sign-in tablet (docs/plans/kiosk-signin-plan.md). Both
// endpoints need a `kiosk` (or admin) login — backend/src/routes/kiosk.routes.js.

export async function fetchKioskState(): Promise<KioskState> {
  const res = await api.get<KioskState>('/kiosk/state');
  return res.data;
}

export async function kioskSignIn(studentId: string): Promise<MutationResult<KioskSignInResult>> {
  try {
    const res = await api.post<KioskSignInResult>('/kiosk/sign-in', { studentId });
    return { status: 'success', data: res.data };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Could not sign in. Please ask the front desk.') };
  }
}
