import { formatTime } from '../formatTime';

describe('formatTime', () => {
  it('formats an afternoon time', () => {
    expect(formatTime('16:00')).toBe('4:00 PM');
  });

  it('formats a morning time', () => {
    expect(formatTime('09:30')).toBe('9:30 AM');
  });

  it('formats midnight as 12:00 AM', () => {
    expect(formatTime('00:00')).toBe('12:00 AM');
  });

  it('formats noon as 12:00 PM', () => {
    expect(formatTime('12:00')).toBe('12:00 PM');
  });

  it('formats a late-night time', () => {
    expect(formatTime('23:45')).toBe('11:45 PM');
  });
});
