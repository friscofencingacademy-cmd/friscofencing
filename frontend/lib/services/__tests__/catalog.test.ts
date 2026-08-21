import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { fetchLocations, createLocation, deleteLocation } from '../catalog';

const LOCATION = { _id: 'loc-1', name: 'Frisco HQ', address: '123 Main St', timezone: 'America/Chicago' };

const server = setupServer(
  http.get('*/locations', () => HttpResponse.json({ locations: [LOCATION] })),
  http.post('*/locations', () =>
    HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
  ),
  http.delete('*/locations/:id', () =>
    HttpResponse.json({ message: 'Cannot delete: 1 class(es) reference this location.' }, { status: 409 })
  )
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('catalog service — query contract (throws on failure)', () => {
  it('fetchLocations resolves with the typed list on success', async () => {
    await expect(fetchLocations()).resolves.toEqual([LOCATION]);
  });

  it('a query function throws (rejects) on a server error', async () => {
    server.use(
      http.get('*/locations', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
    );

    await expect(fetchLocations()).rejects.toBeTruthy();
  });
});

describe('catalog service — mutation contract (never throws)', () => {
  it('createLocation resolves to a status:"error" object on a 500, without throwing', async () => {
    const result = await createLocation({ name: 'X', address: 'Y', timezone: 'America/Chicago' });

    expect(result).toEqual({ status: 'error', message: 'Internal Server Error' });
  });

  it('deleteLocation surfaces the backend 409 message via the same status:"error" shape', async () => {
    const result = await deleteLocation('loc-1');

    expect(result).toEqual({
      status: 'error',
      message: 'Cannot delete: 1 class(es) reference this location.',
    });
  });

  it('createLocation resolves to status:"success" with the created row', async () => {
    server.use(
      http.post('*/locations', () =>
        HttpResponse.json({ location: LOCATION }, { status: 201 })
      )
    );

    const result = await createLocation({ name: 'Frisco HQ', address: '123 Main St', timezone: 'America/Chicago' });

    expect(result).toEqual({ status: 'success', data: LOCATION });
  });
});
