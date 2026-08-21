import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import ChildrenPage from '../page';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

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

beforeAll(() => server.listen());
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

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    const dialog = await screen.findByRole('dialog', { name: /add child/i });

    server.use(
      http.get('*/students/mine', () =>
        HttpResponse.json({ students: [STUDENT, { _id: 'student-2', firstName: 'New', lastName: 'Kid', skillLevel: 'beginner' }] })
      )
    );

    fireEvent.change(within(dialog).getByLabelText('First Name'), { target: { value: 'New' } });
    fireEvent.change(within(dialog).getByLabelText('Last Name'), { target: { value: 'Kid' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /add child/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({ firstName: 'New', lastName: 'Kid', skillLevel: 'beginner' });
    });

    // The modal closes and the context reload brings in the new child.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('link', { name: 'New' })).toBeInTheDocument();
  });

  it('shows an inline error inside the modal on a failed add without crashing', async () => {
    server.use(http.post('*/students', () => HttpResponse.json({ message: 'Failed to add child.' }, { status: 500 })));

    renderChildrenPage();
    await screen.findByText('One');

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));
    const dialog = await screen.findByRole('dialog', { name: /add child/i });

    fireEvent.change(within(dialog).getByLabelText('First Name'), { target: { value: 'New' } });
    fireEvent.change(within(dialog).getByLabelText('Last Name'), { target: { value: 'Kid' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /add child/i }));

    expect(await screen.findByText('Failed to add child.')).toBeInTheDocument();
  });

  it('shows LoadError when the primary students fetch fails', async () => {
    server.use(http.get('*/students/mine', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderChildrenPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
