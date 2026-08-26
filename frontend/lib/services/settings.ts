import api from '../api';
import type { Setting } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// Superadmin-only (backend/src/routes/setting.routes.js) — singleton, no id.

export async function fetchSettings(): Promise<Setting> {
  const res = await api.get<{ settings: Setting }>('/settings');
  return res.data.settings;
}

export async function updateSettings(
  data: Partial<Setting>
): Promise<MutationResult<Setting>> {
  try {
    const res = await api.patch<{ settings: Setting }>('/settings', data);
    return { status: 'success', data: res.data.settings };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to update settings.') };
  }
}
