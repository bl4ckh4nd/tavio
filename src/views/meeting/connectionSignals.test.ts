import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionQuality } from 'livekit-client';
import { useDelayedFlag, useSettledQuality } from './connectionSignals';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDelayedFlag', () => {
  it('stays false for a short blip', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 1500), { initialProps: { active: true } });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ active: false });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(false);
  });

  it('turns true after the delay and false the moment it ends', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 1500), { initialProps: { active: true } });
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});

describe('useSettledQuality', () => {
  it('names a weak link only after it lasted', () => {
    const { result, rerender } = renderHook(({ q }) => useSettledQuality(q, 3000), { initialProps: { q: ConnectionQuality.Good } });
    rerender({ q: ConnectionQuality.Poor });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(ConnectionQuality.Good);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(ConnectionQuality.Poor);
  });

  it('ignores a dip that recovers in time and shows a recovery at once', () => {
    const { result, rerender } = renderHook(({ q }) => useSettledQuality(q, 3000), { initialProps: { q: ConnectionQuality.Excellent } });
    rerender({ q: ConnectionQuality.Poor });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ q: ConnectionQuality.Good });
    expect(result.current).toBe(ConnectionQuality.Good);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(ConnectionQuality.Good);
  });
});
