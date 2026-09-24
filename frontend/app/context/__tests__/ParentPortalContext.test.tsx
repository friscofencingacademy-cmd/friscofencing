import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { ParentPortalProvider, useParentPortal } from '../ParentPortalContext';

const STUDENT = { _id: 'student-1', firstName: 'Kid', lastName: 'One' };

function Consumer() {
  const { students, subscriptions, trialClasses, loading, error, reload } = useParentPortal();

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <p>students: {students.length}</p>
      <p>subscriptions: {subscriptions.length}</p>
      <p>trialClasses: {trialClasses.length}</p>
      {error ? <p role="alert">error</p> : null}
      <button onClick={reload}>Reload</button>
    </div>
  );
}

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] }))
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('ParentPortalContext', () => {
  it('loads students, subscriptions, and trial classes in parallel', async () => {
    render(
      <ParentPortalProvider>
        <Consumer />
      </ParentPortalProvider>
    );

    expect(await screen.findByText('students: 1')).toBeInTheDocument();
    expect(screen.getByText('subscriptions: 0')).toBeInTheDocument();
    expect(screen.getByText('trialClasses: 0')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Private-lesson purchases are fetched only by the page that shows them
  // (/parent/subscriptions) — the context once fetched them too, for no
  // consumer (docs/plans/private-class-per-session-booking-plan.md PR 3).
  it('never fetches private-lesson purchases', async () => {
    let privateFetches = 0;
    server.use(
      http.get('*/private-class-enrollments/mine', () => {
        privateFetches += 1;
        return HttpResponse.json({ enrollments: [] });
      })
    );

    render(
      <ParentPortalProvider>
        <Consumer />
      </ParentPortalProvider>
    );

    expect(await screen.findByText('students: 1')).toBeInTheDocument();
    expect(privateFetches).toBe(0);
  });

  it('sets error when the PRIMARY (students) fetch fails', async () => {
    server.use(http.get('*/students/mine', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    render(
      <ParentPortalProvider>
        <Consumer />
      </ParentPortalProvider>
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('students: 0')).toBeInTheDocument();
  });

  it('does NOT set error when a secondary fetch (subscriptions) fails — students still render', async () => {
    server.use(http.get('*/registrations/mine', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    render(
      <ParentPortalProvider>
        <Consumer />
      </ParentPortalProvider>
    );

    expect(await screen.findByText('students: 1')).toBeInTheDocument();
    expect(screen.getByText('subscriptions: 0')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('an empty household (zero students, no fetch failure) is NOT an error', async () => {
    server.use(http.get('*/students/mine', () => HttpResponse.json({ students: [] })));

    render(
      <ParentPortalProvider>
        <Consumer />
      </ParentPortalProvider>
    );

    expect(await screen.findByText('students: 0')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reload() re-fetches all three', async () => {
    render(
      <ParentPortalProvider>
        <Consumer />
      </ParentPortalProvider>
    );

    await screen.findByText('students: 1');

    server.use(
      http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT, { _id: 's2', firstName: 'Two', lastName: 'Kid' }] }))
    );

    fireEvent.click(screen.getByRole('button', { name: /reload/i }));

    await waitFor(() => expect(screen.getByText('students: 2')).toBeInTheDocument());
  });
});
