import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import LocationsPage from '../page';
import { AuthProvider } from '../../../context/AuthContext';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const ADMIN_USER = {
  _id: 'admin-1',
  role: 'admin',
  firstName: 'Ad',
  lastName: 'Min',
  email: 'admin@example.com',
};

const EXISTING_LOCATION = {
  _id: 'loc-1',
  name: 'Frisco HQ',
  address: '123 Main St',
  timezone: 'America/Chicago',
};

let createdPayload: unknown = null;

// Wildcard host pattern, matching the network-boundary MSW convention
// established in app/login/__tests__/page.test.tsx.
const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })),
  http.get('*/locations', () => HttpResponse.json({ locations: [EXISTING_LOCATION] })),
  http.post('*/locations', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      {
        location: {
          _id: 'loc-2',
          name: 'New Salle',
          address: '789 Oak Ave',
          timezone: 'America/Chicago',
        },
      },
      { status: 201 }
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  pushMock.mockClear();
  createdPayload = null;
});
afterAll(() => server.close());

function renderLocationsPage() {
  return render(
    <AuthProvider>
      <LocationsPage />
    </AuthProvider>
  );
}

describe('LocationsPage', () => {
  it('renders the existing locations table', async () => {
    renderLocationsPage();

    expect(await screen.findByText('Frisco HQ')).toBeInTheDocument();
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
  });

  it('submits the create form and shows the new location', async () => {
    renderLocationsPage();

    await screen.findByText('Frisco HQ');

    // A second GET /locations fires after a successful create — swap in a
    // handler that includes the newly created row so the refetch reflects it.
    server.use(
      http.get('*/locations', () =>
        HttpResponse.json({
          locations: [
            EXISTING_LOCATION,
            { _id: 'loc-2', name: 'New Salle', address: '789 Oak Ave', timezone: 'America/Chicago' },
          ],
        })
      )
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Salle' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '789 Oak Ave' } });
    fireEvent.click(screen.getByRole('button', { name: /add location/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({
        name: 'New Salle',
        address: '789 Oak Ave',
        timezone: 'America/Chicago',
      });
    });

    expect(await screen.findByText('New Salle')).toBeInTheDocument();
  });
});
