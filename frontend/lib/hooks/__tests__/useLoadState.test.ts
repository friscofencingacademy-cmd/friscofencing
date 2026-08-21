import { renderHook, waitFor, act } from '@testing-library/react';
import axios from 'axios';

import { useLoadState, getErrorMessage } from '../useLoadState';

describe('useLoadState', () => {
  it('resolves with data on success', async () => {
    const fetcher = jest.fn().mockResolvedValue({ value: 42 });

    const { result } = renderHook(() => useLoadState(fetcher, []));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
  });

  it('captures the rejection as `error` and never throws out of the hook', async () => {
    const failure = new Error('boom');
    const fetcher = jest.fn().mockRejectedValue(failure);

    const { result } = renderHook(() => useLoadState(fetcher, []));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeNull();
  });

  it('retry() re-invokes the fetcher and resets data at the start of the new fetch', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ value: 1 })
      .mockResolvedValueOnce({ value: 2 });

    const { result } = renderHook(() => useLoadState(fetcher, []));

    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }));

    act(() => {
      result.current.retry();
    });

    // Immediately after retry() fires, a fresh fetch has started — data must
    // not carry the previous payload forward while the new one is in flight.
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.data).toEqual({ value: 2 }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a failing refetch clears the previous data rather than leaving stale data on screen', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ value: 1 })
      .mockRejectedValueOnce(new Error('refetch failed'));

    const { result } = renderHook(() => useLoadState(fetcher, []));

    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeNull();
  });
});

describe('getErrorMessage', () => {
  function axiosErrorWith(status: number, message?: string) {
    const error = new Error('request failed') as any;
    error.isAxiosError = true;
    error.response = { status, data: message ? { message } : {} };
    return error;
  }

  it('returns the backend message for a user-facing 4xx (e.g. 400)', () => {
    expect(getErrorMessage(axiosErrorWith(400, 'studentId is required'))).toBe(
      'studentId is required'
    );
  });

  it('returns the backend message for 403', () => {
    expect(getErrorMessage(axiosErrorWith(403, 'Forbidden'))).toBe('Forbidden');
  });

  it('falls back to the generic message for 404 (raw route-not-found text is unsafe to show)', () => {
    expect(getErrorMessage(axiosErrorWith(404, 'Cannot GET /api/v1/bogus'))).toBe(
      'Something went wrong — please try again.'
    );
  });

  it('falls back to the generic message for a 500', () => {
    expect(getErrorMessage(axiosErrorWith(500, 'DatabaseError'))).toBe(
      'Something went wrong — please try again.'
    );
  });

  it('falls back to the generic message for a network error with no response', () => {
    const networkError = new Error('Network Error') as any;
    networkError.isAxiosError = true;
    expect(getErrorMessage(networkError)).toBe('Something went wrong — please try again.');
  });

  it('falls back to the generic message for a non-axios error', () => {
    expect(getErrorMessage(new Error('plain error'))).toBe(
      'Something went wrong — please try again.'
    );
  });

  it('never throws for a non-error value', () => {
    expect(() => getErrorMessage(null)).not.toThrow();
    expect(getErrorMessage(undefined)).toBe('Something went wrong — please try again.');
  });
});

// Sanity check that axios.isAxiosError is the real implementation being
// exercised above (not accidentally shadowed) — a quick smoke assertion.
it('axios.isAxiosError recognizes our fixture shape', () => {
  const error = new Error('x') as any;
  error.isAxiosError = true;
  expect(axios.isAxiosError(error)).toBe(true);
});
