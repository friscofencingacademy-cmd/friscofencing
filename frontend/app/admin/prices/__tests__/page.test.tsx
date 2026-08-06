import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import PricesPage from '../page';
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

const EXISTING_LEVEL = {
  _id: 'level-1',
  name: 'Beginner',
};

const EXISTING_PRICE = {
  _id: 'price-1',
  levelId: 'level-1',
  monthlyFee: 150,
};

let createdPayload: unknown = null;

// Wildcard host pattern, matching the network-boundary MSW convention
// established in app/login/__tests__/page.test.tsx.
const server = setupServer(
  http.get('*/auth/me', () => HttpResponse.json({ user: ADMIN_USER })),
  http.get('*/prices', () => HttpResponse.json({ prices: [EXISTING_PRICE] })),
  http.get('*/levels', () => HttpResponse.json({ levels: [EXISTING_LEVEL] })),
  http.post('*/prices', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      {
        price: {
          _id: 'price-2',
          levelId: 'level-1',
          monthlyFee: 200,
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

function renderPricesPage() {
  return render(
    <AuthProvider>
      <PricesPage />
    </AuthProvider>
  );
}

describe('PricesPage', () => {
  it('renders the existing prices table with the resolved level name', async () => {
    renderPricesPage();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Beginner')).toBeInTheDocument();
    expect(within(table).getByText('150')).toBeInTheDocument();
  });

  it('submits the create form and shows the new price', async () => {
    renderPricesPage();

    const table = await screen.findByRole('table');
    await within(table).findByText('Beginner');

    // A second GET /prices fires after a successful create — swap in a
    // handler that includes the newly created row so the refetch reflects it.
    server.use(
      http.get('*/prices', () =>
        HttpResponse.json({
          prices: [EXISTING_PRICE, { _id: 'price-2', levelId: 'level-1', monthlyFee: 200 }],
        })
      )
    );

    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'level-1' } });
    fireEvent.change(screen.getByLabelText('Monthly Fee'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: /add price/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({
        levelId: 'level-1',
        monthlyFee: 200,
      });
    });

    expect(await screen.findByText('200')).toBeInTheDocument();
  });
});
