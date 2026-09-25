import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CalendarView from '../CalendarView';
import { bookingHref, type CalendarViewState } from '../../../../lib/calendarView';
import type { CalendarDay } from '../../../../lib/formatDate';
import type { CalendarEvent, CalendarResponse } from '../../../../lib/types';

// The shared calendar (docs/plans/calendar-view-plan.md §2.3), rendered
// controlled — a tiny harness holds the state the way a page does, and records
// every change. `today` is passed in, so no clock is read.
const TODAY: CalendarDay = { year: 2026, month: 10, day: 5 };
const COACH_A = { id: '64b0000000000000000000c1', name: 'Dana Cole' };
const COACH_B = { id: '64b0000000000000000000c2', name: 'Gia Park' };

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'private-open:rule-1:2026-10-06',
    kind: 'private-open',
    day: '2026-10-06',
    startsAt: '2026-10-06T21:30:00.000Z',
    endsAt: '2026-10-06T22:00:00.000Z',
    title: 'Private lesson — 30 min',
    coach: COACH_A,
    locationName: null,
    levelName: null,
    durationMinutes: 30,
    scheduleId: 'rule-1',
    sessionId: null,
    price: 32.5,
    mine: false,
    students: [],
    isHoliday: false,
    holidayName: null,
    ...overrides,
  };
}

// 11:30 PM Central on Tue Oct 6 — already Oct 7 in UTC.
const LATE_LESSON = event({
  id: 'late',
  day: '2026-10-06',
  startsAt: '2026-10-07T04:30:00.000Z',
  endsAt: '2026-10-07T04:45:00.000Z',
  title: 'Private lesson — 15 min',
});
const CLASS = event({
  id: 'group:1',
  kind: 'group',
  day: '2026-10-07',
  startsAt: '2026-10-07T21:00:00.000Z',
  endsAt: '2026-10-07T22:00:00.000Z',
  title: 'Beginner Foil',
  coach: COACH_B,
  locationName: 'Frisco HQ',
  levelName: 'Beginner',
  scheduleId: 'schedule-1',
  sessionId: 'session-1',
  price: null,
});
// Four events on Oct 13 — one more than a cell shows.
const BUSY_DAY = ['16:30', '17:00', '17:30', '18:00'].map((time, index) =>
  event({
    id: `busy-${index}`,
    day: '2026-10-13',
    startsAt: `2026-10-13T${String(Number(time.slice(0, 2)) + 5).padStart(2, '0')}:${time.slice(3)}:00.000Z`,
  })
);

function response(overrides: Partial<CalendarResponse> = {}): CalendarResponse {
  return {
    from: '2026-09-27',
    to: '2026-11-07',
    horizonTo: '2026-12-06',
    events: [LATE_LESSON, CLASS, ...BUSY_DAY],
    coaches: [COACH_A, COACH_B],
    ...overrides,
  };
}

const INITIAL: CalendarViewState = { month: { year: 2026, month: 10 }, coachId: null, type: 'all', view: 'month' };

interface HarnessProps {
  data?: CalendarResponse | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  initial?: CalendarViewState;
  onChange?: (state: CalendarViewState) => void;
}

function Harness({ data = response(), isLoading = false, error = null, onRetry = () => {}, initial = INITIAL, onChange }: HarnessProps) {
  const [state, setState] = useState(initial);
  return (
    <CalendarView
      state={state}
      onStateChange={(next) => {
        onChange?.(next);
        setState(next);
      }}
      today={TODAY}
      data={data}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      eventHref={(item) => bookingHref(item, true)}
    />
  );
}

function dayCell(name: RegExp) {
  return screen.getByRole('cell', { name });
}

describe('CalendarView', () => {
  it("places an event on the server's day — an 11:30 PM Central lesson stays on Tuesday", () => {
    render(<Harness />);

    const tuesday = dayCell(/Tuesday, October 6/);
    const lesson = within(tuesday).getByRole('link', { name: /11:30 PM/ });
    expect(lesson).toHaveAccessibleName('Open slot, 11:30 PM, Private lesson — 15 min, Dana Cole');
    expect(within(dayCell(/Wednesday, October 7/)).queryByText('11:30 PM')).not.toBeInTheDocument();
  });

  it('writes every kind out in text next to its color, and links into the existing booking flows', () => {
    render(<Harness />);

    const wednesday = dayCell(/Wednesday, October 7/);
    expect(within(wednesday).getByText('Class')).toBeInTheDocument();
    expect(within(wednesday).getByRole('link', { name: /Class, 4:00 PM, Beginner Foil/ })).toHaveAttribute(
      'href',
      '/parent/book-trial'
    );
    expect(within(dayCell(/Tuesday, October 6/)).getByText('Open slot')).toBeInTheDocument();
    expect(within(dayCell(/Tuesday, October 6/)).getByRole('link')).toHaveAttribute(
      'href',
      '/parent/register-private?slot=rule-1&day=2026-10-06'
    );
  });

  it('marks today, and only today', () => {
    render(<Harness />);

    expect(dayCell(/Monday, October 5/)).toHaveAttribute('aria-current', 'date');
    expect(dayCell(/Tuesday, October 6/)).not.toHaveAttribute('aria-current');
  });

  it('shows three events per day, then "+N more", which opens that day in the list', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    const busy = dayCell(/Tuesday, October 13/);
    expect(within(busy).getAllByRole('link')).toHaveLength(3);

    await user.click(within(busy).getByRole('button', { name: '1 more on Tuesday, October 13' }));

    expect(onChange).toHaveBeenLastCalledWith({ ...INITIAL, view: 'agenda' });
    const heading = await screen.findByRole('heading', { name: 'Tuesday, October 13' });
    expect(heading).toHaveFocus();
    expect(within(heading.closest('section')!).getAllByRole('link')).toHaveLength(4);
  });

  it('moves between months with previous, next and today', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Harness onChange={onChange} initial={{ ...INITIAL, month: { year: 2026, month: 11 } }} />);

    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ month: { year: 2026, month: 12 } }));

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ month: { year: 2026, month: 10 } }));

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ month: { year: 2026, month: 10 } }));
  });

  it('stops "next" at the booking horizon and "previous" at the current month', () => {
    const { unmount } = render(<Harness initial={{ ...INITIAL, month: { year: 2026, month: 12 } }} />);
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeEnabled();
    unmount();

    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
  });

  it('allows both directions with no horizon (the admin calendar)', () => {
    render(<Harness data={response({ horizonTo: null })} initial={{ ...INITIAL, month: { year: 2027, month: 6 } }} />);

    expect(screen.getByRole('button', { name: 'Previous month' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
  });

  it("filters by coach from the backend's coach list, and by type", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    const select = screen.getByRole('combobox', { name: 'Coach' });
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All coaches',
      'Dana Cole',
      'Gia Park',
    ]);

    await user.selectOptions(select, 'Gia Park');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ coachId: COACH_B.id }));

    await user.click(screen.getByRole('radio', { name: 'Private lessons' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ coachId: COACH_B.id, type: 'private' }));
    expect(screen.getByRole('radio', { name: 'Private lessons' })).toHaveAttribute('aria-checked', 'true');

    await user.selectOptions(select, 'All coaches');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ coachId: null }));
  });

  it('switches between the month grid and the list, and the list shows times, details and the server price', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'List' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tuesday, October 6' })).toBeInTheDocument();
    expect(screen.getByText('11:30 PM – 11:45 PM')).toBeInTheDocument();
    expect(screen.getByText('Gia Park · Frisco HQ · Beginner')).toBeInTheDocument();
    expect(screen.getAllByText('Dana Cole · $32.50 / session')).toHaveLength(5);
  });

  it('lists only the shown month in the list, though the grid request spans neighboring days', async () => {
    const user = userEvent.setup();
    const november = event({ id: 'nov', day: '2026-11-03', startsAt: '2026-11-03T22:30:00.000Z' });
    render(<Harness data={response({ events: [CLASS, november] })} initial={{ ...INITIAL, view: 'agenda' }} />);

    expect(screen.getByRole('heading', { name: 'Wednesday, October 7' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tuesday, November 3' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Month' }));
    // The grid does draw Nov 3 — it is one of October's trailing cells.
    expect(within(dayCell(/Tuesday, November 3/)).getByRole('link')).toBeInTheDocument();
  });

  it('says so when the month is empty, and names the horizon past it', () => {
    const { unmount } = render(<Harness data={response({ events: [] })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing scheduled this month.');
    unmount();

    render(<Harness data={response({ events: [] })} initial={{ ...INITIAL, month: { year: 2027, month: 1 } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Booking is open through Sunday, December 6.');
  });

  it('shows loading in place of the calendar', () => {
    render(<Harness data={null} isLoading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows LoadError in place of the calendar, and its retry calls back', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    render(<Harness data={null} error={new Error('boom')} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps a coach from a shared link selectable when they have nothing this month', () => {
    render(<Harness data={response({ coaches: [COACH_A] })} initial={{ ...INITIAL, coachId: COACH_B.id }} />);

    expect(screen.getByRole('combobox', { name: 'Coach' })).toHaveValue(COACH_B.id);
  });
});
