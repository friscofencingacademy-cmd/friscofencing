import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../test-utils/msw';

import AdminDashboardPage from '../page';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

const server = setupServer(
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [{}, {}] })),
  http.get('*/group-class-schedules', () => HttpResponse.json({ schedules: [{}] })),
  http.get('*/locations', () => HttpResponse.json({ locations: [{}, {}, {}] })),
  http.get('*/levels', () => HttpResponse.json({ levels: [{}] }))
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('AdminDashboardPage', () => {
  it('renders raw list counts for each catalog/scheduling entity', async () => {
    render(<AdminDashboardPage />);

    expect(await screen.findByText('2')).toBeInTheDocument(); // classes
    expect(screen.getAllByText('1', { exact: true })).toHaveLength(2); // schedules + levels
    expect(screen.getByText('3')).toBeInTheDocument(); // locations
  });

  it('renders no quick-links grid — the sidebar already covers every admin section', async () => {
    render(<AdminDashboardPage />);

    await screen.findByText('Dashboard');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows LoadError with a working retry when a count fetch fails', async () => {
    server.use(http.get('*/group-classes', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    render(<AdminDashboardPage />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    server.resetHandlers(
      http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [{}, {}] })),
      http.get('*/group-class-schedules', () => HttpResponse.json({ schedules: [{}] })),
      http.get('*/locations', () => HttpResponse.json({ locations: [{}, {}, {}] })),
      http.get('*/levels', () => HttpResponse.json({ levels: [{}] }))
    );

    await user.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
