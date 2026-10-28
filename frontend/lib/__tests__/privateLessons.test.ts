import {
  formatWindowLabel,
  groupAvailabilityWindows,
  slotCount,
  slotWindowOf,
  windowRemovalMessage,
} from '../privateLessons';
import type { CoachPrivateAvailabilityRule } from '../types';

const OCT_RANGE = { startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' };

function rule(
  id: string,
  startTime: string,
  overrides: Partial<CoachPrivateAvailabilityRule> = {}
): CoachPrivateAvailabilityRule {
  return {
    _id: id,
    coachId: 'coach-1',
    dayOfWeek: 2,
    startTime,
    durationMinutes: 15,
    ...OCT_RANGE,
    isActive: true,
    bookedCount: 0,
    ...overrides,
  };
}

const byCoach = (r: CoachPrivateAvailabilityRule) => r.coachId;

// Bulk publish "Tue 6–8 pm, 15 min" stores these 8 rules.
const SIX_TO_EIGHT = ['18:00', '18:15', '18:30', '18:45', '19:00', '19:15', '19:30', '19:45'].map((time, index) =>
  rule(`r${index}`, time)
);

describe('groupAvailabilityWindows', () => {
  it('shows the 8 slots of a 6–8 pm, 15-minute publish as one window', () => {
    const [window, ...rest] = groupAvailabilityWindows(SIX_TO_EIGHT, byCoach);

    expect(rest).toHaveLength(0);
    expect(window.rules).toHaveLength(8);
    expect(window.startTime).toBe('18:00');
    expect(window.endTime).toBe('20:00');
    expect(window.durationMinutes).toBe(15);
    expect(formatWindowLabel(window)).toBe('Tuesdays · 6:00 PM–8:00 PM');
  });

  it('groups regardless of the order the rules arrive in', () => {
    const [window] = groupAvailabilityWindows([...SIX_TO_EIGHT].reverse(), byCoach);

    expect(window.rules.map((r) => r.startTime)).toEqual(SIX_TO_EIGHT.map((r) => r.startTime));
  });

  it('sums upcoming bookings across the window', () => {
    const rules = [rule('a', '18:00', { bookedCount: 2 }), rule('b', '18:15'), rule('c', '18:30', { bookedCount: 1 })];

    expect(groupAvailabilityWindows(rules, byCoach)[0].bookedCount).toBe(3);
  });

  it('splits at a gap in time — a removed or never-published slot ends the window', () => {
    const rules = [rule('a', '18:00'), rule('b', '18:15'), rule('c', '19:00'), rule('d', '19:15')];

    const windows = groupAvailabilityWindows(rules, byCoach);

    expect(windows.map(formatWindowLabel)).toEqual(['Tuesdays · 6:00 PM–6:30 PM', 'Tuesdays · 7:00 PM–7:30 PM']);
  });

  it('keeps apart slots that differ in weekday, length, bookable range or coach', () => {
    const rules = [
      rule('base', '18:00'),
      rule('otherDay', '18:15', { dayOfWeek: 4 }),
      rule('otherLength', '18:15', { durationMinutes: 30 }),
      rule('otherRange', '18:15', { endDate: '2026-11-30T00:00:00.000Z' }),
      rule('otherCoach', '18:15', { coachId: 'coach-2' }),
    ];

    expect(groupAvailabilityWindows(rules, byCoach)).toHaveLength(5);
  });

  it('orders windows by coach (first seen), then weekday, then start time', () => {
    const rules = [
      rule('c2-mon', '10:00', { coachId: 'coach-2', dayOfWeek: 1 }),
      rule('c1-thu', '09:00', { dayOfWeek: 4 }),
      rule('c1-tue-late', '19:00'),
      rule('c2-sun', '12:00', { coachId: 'coach-2', dayOfWeek: 0 }),
      rule('c1-tue-early', '08:00'),
    ];

    expect(groupAvailabilityWindows(rules, byCoach).map((w) => w.rules[0]._id)).toEqual([
      'c2-sun',
      'c2-mon',
      'c1-tue-early',
      'c1-tue-late',
      'c1-thu',
    ]);
  });

  it('returns no windows for no rules', () => {
    expect(groupAvailabilityWindows([], byCoach)).toEqual([]);
  });
});

describe('slotWindowOf', () => {
  it('names one slot of a window as a window of its own, with its own bookings', () => {
    const [window] = groupAvailabilityWindows(SIX_TO_EIGHT, byCoach);
    const slot = slotWindowOf(window, { ...SIX_TO_EIGHT[2], bookedCount: 2 });

    expect(slot.rules.map((r) => r._id)).toEqual(['r2']);
    expect(formatWindowLabel(slot)).toBe('Tuesdays · 6:30 PM–6:45 PM');
    expect(slot.bookedCount).toBe(2);
    expect(slot.key).not.toBe(window.key);
    expect(slot.key).not.toBe(slotWindowOf(window, SIX_TO_EIGHT[3]).key);
  });

  it('reports removing it in the window removal wording', () => {
    const [window] = groupAvailabilityWindows(SIX_TO_EIGHT, byCoach);
    const slot = slotWindowOf(window, SIX_TO_EIGHT[2]);

    expect(windowRemovalMessage(slot, { removed: 1, retired: 0, failures: [] })).toEqual({
      ok: true,
      message: 'Availability removed.',
    });
    expect(
      windowRemovalMessage(slot, { removed: 0, retired: 0, failures: [{ id: 'r2', message: 'It has bookings.' }] })
    ).toEqual({ ok: false, message: "Nothing was removed. 6:30 PM wasn't removed: It has bookings." });
  });
});

describe('windowRemovalMessage', () => {
  const [window] = groupAvailabilityWindows(SIX_TO_EIGHT, byCoach);

  it('reports a clean removal', () => {
    expect(windowRemovalMessage(window, { removed: 8, retired: 0, failures: [] })).toEqual({
      ok: true,
      message: 'Availability removed.',
    });
  });

  it('says past lessons stay on record when some slots were retired rather than deleted', () => {
    expect(windowRemovalMessage(window, { removed: 6, retired: 2, failures: [] }).message).toBe(
      'Availability removed — slots with past lessons stay on record.'
    );
  });

  it('names every slot the backend kept, with its reason, when a booking landed since the page loaded', () => {
    const reason = 'This slot has upcoming bookings — cancel them before removing it';

    expect(
      windowRemovalMessage(window, {
        removed: 6,
        retired: 0,
        failures: [
          { id: 'r1', message: reason },
          { id: 'r4', message: reason },
        ],
      })
    ).toEqual({ ok: false, message: `Removed 6 of 8 slots. 6:15 PM, 7:00 PM weren't removed: ${reason}` });
  });

  it('says nothing was removed when every slot failed', () => {
    const failures = window.rules.map((r) => ({ id: r._id, message: 'Network Error' }));

    expect(windowRemovalMessage(window, { removed: 0, retired: 0, failures }).message).toMatch(
      /^Nothing was removed\. 6:00 PM, .* weren't removed: Network Error$/
    );
  });
});

describe('slotCount', () => {
  it('pluralises', () => {
    expect(slotCount(1)).toBe('1 slot');
    expect(slotCount(8)).toBe('8 slots');
  });
});
