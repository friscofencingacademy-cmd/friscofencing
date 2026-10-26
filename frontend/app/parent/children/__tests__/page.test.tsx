import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../test-utils/msw';

import ChildrenPage from '../page';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

const STUDENT = { _id: 'student-1', firstName: 'Kid', lastName: 'One', skillLevel: 'beginner' };

let createdPayload: unknown = null;

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.post('*/students', async ({ request }) => {
    createdPayload = await request.json();
    return HttpResponse.json(
      { student: { _id: 'student-2', firstName: 'New', lastName: 'Kid', skillLevel: 'beginner' } },
      { status: 201 }
    );
  })
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => {
  server.resetHandlers();
  createdPayload = null;
});
afterAll(() => server.close());

function renderChildrenPage() {
  return render(
    <ParentPortalProvider>
      <ChildrenPage />
    </ParentPortalProvider>
  );
}

describe('ChildrenPage', () => {
  it('renders children from ParentPortalContext (no own fetch), linking each row to the child detail page', async () => {
    renderChildrenPage();

    const nameLink = await screen.findByRole('link', { name: 'Kid' });
    expect(nameLink).toHaveAttribute('href', `/parent/child/${STUDENT._id}`);
    expect(screen.getByText('One')).toBeInTheDocument();
  });

  it('opens the AddChildModal, submits the exact payload, and reloads via context on success', async () => {
    renderChildrenPage();
    await screen.findByText('One');

    await user.click(screen.getByRole('button', { name: /add child/i }));

    const dialog = await screen.findByRole('dialog', { name: /add child/i });

    server.use(
      http.get('*/students/mine', () =>
        HttpResponse.json({ students: [STUDENT, { _id: 'student-2', firstName: 'New', lastName: 'Kid', skillLevel: 'beginner' }] })
      )
    );

    await user.type(within(dialog).getByLabelText('First Name'), 'New');
    await user.type(within(dialog).getByLabelText('Last Name'), 'Kid');
    await user.type(within(dialog).getByLabelText('Date of Birth'), '2018-01-01');
    await user.click(within(dialog).getByRole('button', { name: /add child/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({
        firstName: 'New',
        lastName: 'Kid',
        skillLevel: 'beginner',
        dateOfBirth: '2018-01-01',
      });
    });

    // The modal closes and the context reload brings in the new child.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('link', { name: 'New' })).toBeInTheDocument();
  });

  it('shows an inline error inside the modal on a failed add without crashing', async () => {
    server.use(http.post('*/students', () => HttpResponse.json({ message: 'Failed to add child.' }, { status: 500 })));

    renderChildrenPage();
    await screen.findByText('One');

    await user.click(screen.getByRole('button', { name: /add child/i }));
    const dialog = await screen.findByRole('dialog', { name: /add child/i });

    await user.type(within(dialog).getByLabelText('First Name'), 'New');
    await user.type(within(dialog).getByLabelText('Last Name'), 'Kid');
    await user.type(within(dialog).getByLabelText('Date of Birth'), '2018-01-01');
    await user.click(within(dialog).getByRole('button', { name: /add child/i }));

    expect(await screen.findByText('Failed to add child.')).toBeInTheDocument();
  });

  it('shows LoadError when the primary students fetch fails', async () => {
    server.use(http.get('*/students/mine', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderChildrenPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
