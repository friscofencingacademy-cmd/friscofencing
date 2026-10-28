import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { onUnhandledRequest } from '../../../../../test-utils/msw';

import TrialActions from '../index';
import type { Student, UpcomingTrial } from '../../../../../lib/types';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

let deleteCount = 0;

const server = setupServer(
  http.delete('*/trial-classes/trial-1', () => {
    deleteCount += 1;
    return HttpResponse.json({ success: true });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest }));
afterEach(() => {
  server.resetHandlers();
  deleteCount = 0;
});
afterAll(() => server.close());

// 21:00Z–22:00Z on Nov 3 2026 is 3:00–4:00 PM Central (CST, UTC-6 — DST ends
// Nov 1 2026).
const TRIAL: UpcomingTrial = {
  _id: 'trial-1',
  sessionId: 'session-1',
  startsAt: '2026-11-03T21:00:00.000Z',
  endsAt: '2026-11-03T22:00:00.000Z',
  canChange: true,
};

function studentWith(enrollment: Student['enrollment']): Student {
  return { _id: 'student-1', firstName: 'Ada', lastName: 'Kid', enrollment };
}

const SCHEDULED = studentWith({ status: 'trial_scheduled', canBookTrial: false, schedule: null, trial: TRIAL });

describe('TrialActions', () => {
  it('links Reschedule to the wizard in reschedule mode for this child, and offers Cancel', () => {
    render(<TrialActions student={SCHEDULED} onCancelled={jest.fn()} />);

    expect(screen.getByRole('link', { name: 'Reschedule trial' })).toHaveAttribute(
      'href',
      '/parent/book-trial?reschedule=student-1'
    );
    expect(screen.getByRole('button', { name: 'Cancel trial' })).toBeInTheDocument();
  });

  // The server's canChange is the only gate — never a date comparison here.
  describe('renders nothing unless the server says the trial can change', () => {
    it.each([
      ['canChange is false (attendance taken, or the class started)', studentWith({ status: 'trial_scheduled', canBookTrial: false, schedule: null, trial: { ...TRIAL, canChange: false } })],
      ['the trial is completed', studentWith({ status: 'trial_completed', canBookTrial: false, schedule: null, trial: null })],
      ['there is no trial', studentWith({ status: 'not_enrolled', canBookTrial: true, schedule: null, trial: null })],
      ['a scheduled trial arrives without its details', studentWith({ status: 'trial_scheduled', canBookTrial: false, schedule: null, trial: null })],
    ])('when %s', (_label, student) => {
      const { container } = render(<TrialActions student={student} onCancelled={jest.fn()} />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  it('asks for confirmation naming the child and the trial date, then cancels and reports back', async () => {
    const onCancelled = jest.fn();
    render(<TrialActions student={SCHEDULED} onCancelled={onCancelled} />);

    await user.click(screen.getByRole('button', { name: 'Cancel trial' }));

    const dialog = screen.getByRole('dialog', { name: 'Cancel Trial' });
    expect(dialog).toHaveTextContent("Cancel Ada's free trial on Tue, Nov 3 · 3:00 PM–4:00 PM? You can book a new trial afterwards.");

    await user.click(screen.getByRole('button', { name: 'Cancel Trial' }));

    expect(await screen.findByRole('button', { name: 'Cancel trial' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(deleteCount).toBe(1);
  });

  it('"Keep Trial" closes the dialog without cancelling', async () => {
    const onCancelled = jest.fn();
    render(<TrialActions student={SCHEDULED} onCancelled={onCancelled} />);

    await user.click(screen.getByRole('button', { name: 'Cancel trial' }));
    await user.click(screen.getByRole('button', { name: 'Keep Trial' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCancelled).not.toHaveBeenCalled();
    expect(deleteCount).toBe(0);
  });

  it("shows the server's refusal inline in the dialog without crashing, and keeps the trial", async () => {
    server.use(
      http.delete('*/trial-classes/trial-1', () =>
        HttpResponse.json(
          { message: 'This trial class has already started — it can no longer be changed' },
          { status: 400 }
        )
      )
    );
    const onCancelled = jest.fn();
    render(<TrialActions student={SCHEDULED} onCancelled={onCancelled} />);

    await user.click(screen.getByRole('button', { name: 'Cancel trial' }));
    await user.click(screen.getByRole('button', { name: 'Cancel Trial' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This trial class has already started — it can no longer be changed'
    );
    expect(screen.getByRole('dialog', { name: 'Cancel Trial' })).toBeInTheDocument();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it('clears an earlier error when the dialog is closed and opened again', async () => {
    server.use(
      http.delete('*/trial-classes/trial-1', () => HttpResponse.json({ message: 'Nope' }, { status: 409 }))
    );
    render(<TrialActions student={SCHEDULED} onCancelled={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Cancel trial' }));
    await user.click(screen.getByRole('button', { name: 'Cancel Trial' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope');

    await user.click(screen.getByRole('button', { name: 'Keep Trial' }));
    await user.click(screen.getByRole('button', { name: 'Cancel trial' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
