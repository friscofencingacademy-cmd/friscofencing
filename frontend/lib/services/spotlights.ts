import api from '../api';
import type { PublicSpotlight, Spotlight, SpotlightType } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// ── Public (no auth) ─────────────────────────────────────────────────────

export async function fetchPublicSpotlights(type: SpotlightType): Promise<PublicSpotlight[]> {
  const res = await api.get<{ spotlights: PublicSpotlight[] }>('/spotlights/public', {
    params: { type },
  });
  return res.data.spotlights;
}

// ── Admin CRUD ───────────────────────────────────────────────────────────

export async function fetchSpotlights(): Promise<Spotlight[]> {
  const res = await api.get<{ spotlights: Spotlight[] }>('/spotlights');
  return res.data.spotlights;
}

export type SpotlightInput = Pick<
  Spotlight,
  'type' | 'name' | 'title' | 'body' | 'bullets' | 'imageUrl' | 'isPublished' | 'order'
>;

export async function createSpotlight(
  data: SpotlightInput
): Promise<MutationResult<Spotlight>> {
  try {
    const res = await api.post<{ spotlight: Spotlight }>('/spotlights', data);
    return { status: 'success', data: res.data.spotlight };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create spotlight.') };
  }
}

export async function updateSpotlight(
  id: string,
  data: Partial<SpotlightInput>
): Promise<MutationResult<Spotlight>> {
  try {
    const res = await api.put<{ spotlight: Spotlight }>(`/spotlights/${id}`, data);
    return { status: 'success', data: res.data.spotlight };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to update spotlight.') };
  }
}

export async function deleteSpotlight(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.delete(`/spotlights/${id}`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to delete spotlight.') };
  }
}
