import { act, renderHook } from '@testing-library/react';

import { useDebouncedValue } from '../useDebouncedValue';

// Fake timers: the hook is pure timing, so the test controls the clock rather
// than waiting on the real one (docs/TESTING_STRATEGY.md).
describe('useDebouncedValue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts with the initial value', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 400));

    expect(result.current).toBe('a');
  });

  it('updates only after the value has stopped changing for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    act(() => {
      jest.advanceTimersByTime(399);
    });
    expect(result.current).toBe('a');

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe('ab');
  });

  it('restarts the wait on every change, so a burst yields only the last value', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: '' },
    });

    rerender({ value: '3' });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    rerender({ value: '30' });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    rerender({ value: '300' });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(result.current).toBe('');

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current).toBe('300');
  });
});
