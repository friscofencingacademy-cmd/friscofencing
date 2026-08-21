import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  it('renders children from ParentPortalContext (no own fetch)', async () => {
    renderChildrenPage();

    expect(await screen.findByText('Kid')).toBeInTheDocument();
    expect(screen.getByText('One')).toBeInTheDocument();
  });

  it('adds a child via the mutation service and reloads the context', async () => {
    renderChildrenPage();
    await screen.findByText('Kid');

    server.use(
      http.get('*/students/mine', () =>
        HttpResponse.json({ students: [STUDENT, { _id: 'student-2', firstName: 'New', lastName: 'Kid', skillLevel: 'beginner' }] })
      )
    );

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Kid' } });
    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    await waitFor(() => {
      expect(createdPayload).toEqual({ firstName: 'New', lastName: 'Kid', skillLevel: 'beginner' });
    });

    expect(await screen.findByText('New')).toBeInTheDocument();
  });

  it('shows an inline error on a failed add without crashing', async () => {
    server.use(http.post('*/students', () => HttpResponse.json({ message: 'Failed to add child.' }, { status: 500 })));

    renderChildrenPage();
    await screen.findByText('Kid');

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Kid' } });
    fireEvent.click(screen.getByRole('button', { name: /add child/i }));

    expect(await screen.findByText('Failed to add child.')).toBeInTheDocument();
  });

  it('shows LoadError when the primary students fetch fails', async () => {
    server.use(http.get('*/students/mine', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderChildrenPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
