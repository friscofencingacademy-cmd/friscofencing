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

// Uploads an image file to Vercel Blob (via POST /spotlights/upload-image)
// and resolves to its public URL — the caller stores that URL into the
// spotlight's own `imageUrl` field like any manually-entered one.
export async function uploadSpotlightImage(file: File): Promise<MutationResult<string>> {
  try {
    const formData = new FormData();
    formData.append('image', file);

    const res = await api.post<{ imageUrl: string }>('/spotlights/upload-image', formData);
    return { status: 'success', data: res.data.imageUrl };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to upload image.') };
  }
}
