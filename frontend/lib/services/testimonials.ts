import api from '../api';
import type { PublicTestimonial, Testimonial } from '../types';
import { extractErrorMessage, type MutationResult } from './shared';

// ── Public (no auth) ─────────────────────────────────────────────────────

export async function fetchPublicTestimonials(): Promise<PublicTestimonial[]> {
  const res = await api.get<{ testimonials: PublicTestimonial[] }>('/testimonials/public');
  return res.data.testimonials;
}

// ── Admin CRUD ───────────────────────────────────────────────────────────

export async function fetchTestimonials(): Promise<Testimonial[]> {
  const res = await api.get<{ testimonials: Testimonial[] }>('/testimonials');
  return res.data.testimonials;
}

export type TestimonialInput = Pick<
  Testimonial,
  'quote' | 'authorName' | 'caption' | 'imageUrl' | 'isPublished' | 'order'
>;

export async function createTestimonial(
  data: TestimonialInput
): Promise<MutationResult<Testimonial>> {
  try {
    const res = await api.post<{ testimonial: Testimonial }>('/testimonials', data);
    return { status: 'success', data: res.data.testimonial };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to create testimonial.') };
  }
}

export async function updateTestimonial(
  id: string,
  data: Partial<TestimonialInput>
): Promise<MutationResult<Testimonial>> {
  try {
    const res = await api.put<{ testimonial: Testimonial }>(`/testimonials/${id}`, data);
    return { status: 'success', data: res.data.testimonial };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to update testimonial.') };
  }
}

export async function deleteTestimonial(id: string): Promise<MutationResult<undefined>> {
  try {
    await api.delete(`/testimonials/${id}`);
    return { status: 'success', data: undefined };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to delete testimonial.') };
  }
}

// Uploads an image file to Vercel Blob (via POST /testimonials/upload-image)
// and resolves to its public URL — the caller stores that URL into the
// testimonial's own `imageUrl` field like any manually-entered one.
export async function uploadTestimonialImage(file: File): Promise<MutationResult<string>> {
  try {
    const formData = new FormData();
    formData.append('image', file);

    const res = await api.post<{ imageUrl: string }>('/testimonials/upload-image', formData);
    return { status: 'success', data: res.data.imageUrl };
  } catch (err) {
    return { status: 'error', message: extractErrorMessage(err, 'Failed to upload image.') };
  }
}
