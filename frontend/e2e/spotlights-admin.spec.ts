import { test, expect } from './fixtures/test';

import type { IgnoredBodyResponse, ImageUploadResponse, SpotlightResponse, SpotlightsResponse } from '../lib/apiResponses';
import type { Spotlight } from '../lib/types';
import { json, type MockRule } from './fixtures/mock-api';
import { loginAs } from './fixtures/auth';
import { expectNoBlockingA11yViolations } from './helpers/a11y';

// Spotlight admin content (/admin/spotlights, docs/features/public-site.md)
// in a real browser — the Jest page test's cases
// (app/admin/spotlights/__tests__/page.test.tsx) with a real file input and a
// real multipart upload. Every request body is asserted exactly.

const JANE: Spotlight = {
  _id: 'spot-1',
  type: 'coach',
  name: 'Jane Smith',
  title: 'Head Coach',
  body: 'Jane has coached for 15 years.',
  bullets: ['NCAA fencer', 'USFA certified'],
  imageUrl: 'https://example.com/jane.jpg',
  isPublished: false,
  order: 1,
};

const UPLOADED_URL = 'https://blob.example.com/spotlights/uploaded.png';

// The smallest valid PNG (1 x 1, transparent) — a real image the browser sends as multipart.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

test.describe('admin spotlights', () => {
  test('creates a spotlight with an uploaded image, sending the uploaded URL and only the filled fields', async ({ page }) => {
    let spotlights: Spotlight[] = [JANE];
    let uploadContentType: string | null = null;
    let createBody: unknown = null;
    const overrides: MockRule[] = [
      { method: 'GET', path: '/spotlights', handler: (route) => json<SpotlightsResponse>(route, 200, { spotlights }) },
      {
        method: 'POST',
        path: '/spotlights/upload-image',
        handler: (route) => {
          uploadContentType = route.request().headers()['content-type'] ?? null;
          return json<ImageUploadResponse>(route, 201, { imageUrl: UPLOADED_URL });
        },
      },
      {
        method: 'POST',
        path: '/spotlights',
        handler: (route) => {
          createBody = route.request().postDataJSON();
          const created: Spotlight = { _id: 'spot-2', type: 'student', name: 'New Spotlight', bullets: ['Only bullet'], imageUrl: UPLOADED_URL, isPublished: false, order: 0 };
          spotlights = [...spotlights, created];
          return json<SpotlightResponse>(route, 201, { spotlight: created });
        },
      },
    ];
    await loginAs(page, 'admin', overrides);
    await page.goto('/admin/spotlights');
    await expect(page.getByText('Jane Smith')).toBeVisible();
    await expectNoBlockingA11yViolations(page);

    await page.getByRole('button', { name: /add spotlight/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Type').selectOption('student');
    await dialog.getByLabel('Name').fill('New Spotlight');
    await dialog.getByLabel('Bullet 1').fill('Only bullet');
    await dialog.getByLabel('Or upload a file:').setInputFiles({ name: 'student.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });
    await expect(dialog.getByLabel('Image URL')).toHaveValue(UPLOADED_URL);
    expect(uploadContentType).toMatch(/^multipart\/form-data; boundary=/);

    await dialog.getByRole('button', { name: /^create$/i }).click();

    await expect(page.getByRole('row').filter({ hasText: 'New Spotlight' })).toBeVisible();
    // Blank optional fields are omitted (undefined is dropped by JSON), empty bullets trimmed.
    expect(createBody).toEqual({
      type: 'student',
      name: 'New Spotlight',
      bullets: ['Only bullet'],
      imageUrl: UPLOADED_URL,
      isPublished: false,
      order: 0,
    });
  });

  test('publishing an existing spotlight sends its full, prefilled record with isPublished true', async ({ page }) => {
    let updatedId: string | null = null;
    let updateBody: unknown = null;
    const overrides: MockRule[] = [
      { method: 'GET', path: '/spotlights', handler: (route) => json<SpotlightsResponse>(route, 200, { spotlights: [JANE] }) },
      {
        method: 'PUT',
        path: '/spotlights/:id',
        handler: (route, { params }) => {
          updatedId = params.id;
          updateBody = route.request().postDataJSON();
          return json<SpotlightResponse>(route, 200, { spotlight: { ...JANE, isPublished: true } });
        },
      },
    ];
    await loginAs(page, 'admin', overrides);
    await page.goto('/admin/spotlights');

    await page.getByRole('button', { name: /edit jane smith/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Bullet 1')).toHaveValue('NCAA fencer');
    await expect(dialog.getByLabel('Bullet 2')).toHaveValue('USFA certified');
    const published = dialog.getByLabel('Published');
    await expect(published).not.toBeChecked();
    await published.check();
    await expect(published).toBeChecked();
    await dialog.getByRole('button', { name: /save changes/i }).click();

    await expect(dialog).toBeHidden();
    expect(updatedId).toBe('spot-1');
    expect(updateBody).toEqual({
      type: 'coach',
      name: 'Jane Smith',
      title: 'Head Coach',
      body: 'Jane has coached for 15 years.',
      bullets: ['NCAA fencer', 'USFA certified'],
      imageUrl: 'https://example.com/jane.jpg',
      isPublished: true,
      order: 1,
    });
  });

  test('deleting asks for confirmation, deletes that spotlight, and removes its row', async ({ page }) => {
    let deletedId: string | null = null;
    const overrides: MockRule[] = [
      { method: 'GET', path: '/spotlights', handler: (route) => json<SpotlightsResponse>(route, 200, { spotlights: [JANE] }) },
      {
        method: 'DELETE',
        path: '/spotlights/:id',
        handler: (route, { params }) => {
          deletedId = params.id;
          return json<IgnoredBodyResponse>(route, 200, {});
        },
      },
    ];
    await loginAs(page, 'admin', overrides);
    await page.goto('/admin/spotlights');

    await page.getByRole('button', { name: /delete jane smith/i }).click();
    await expect(page.getByText(/delete "jane smith"\? this cannot be undone\./i)).toBeVisible();
    await page.getByRole('button', { name: /^delete$/i }).click();

    await expect(page.getByText('Jane Smith')).toHaveCount(0);
    expect(deletedId).toBe('spot-1');
  });
});
