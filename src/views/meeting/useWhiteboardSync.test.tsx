import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import type { WhiteboardElement } from '../../types';

const save = vi.hoisted(() => vi.fn());
vi.mock('convex/react', () => ({ useMutation: () => save }));

import { useWhiteboardSync } from './useWhiteboardSync';

const rect = (id: string, x = 0) => ({ id, type: 'shape', shapeType: 'rect', x, y: 0, width: 10, height: 10 }) as unknown as WhiteboardElement;

describe('useWhiteboardSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    save.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('keeps an edit whose save failed and sends it with the next save', async () => {
    save.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({});
    const { result } = renderHook(() => useWhiteboardSync('room', 'token'));
    const a = rect('a');
    const b = rect('b', 20);

    await act(async () => { void result.current.handleWhiteboardCommit([a], [], 1); });
    expect(result.current.whiteboardError).not.toBeNull();

    // Drawn while the retry waits; the board already contains `a`.
    await act(async () => { void result.current.handleWhiteboardCommit([a, b], [a], 1); });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(2);
    const retried = save.mock.calls[1][0];
    expect(retried.elements.map((el: WhiteboardElement) => el.id).sort()).toEqual(['a', 'b']);
    expect(retried.edit.addedIds.sort()).toEqual(['a', 'b']);
    expect(result.current.whiteboardError).toBeNull();
  });

  it('does not carry a failed edit of a replaced board onto the new one', async () => {
    save.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({});
    const { result } = renderHook(() => useWhiteboardSync('room', 'token'));

    await act(async () => { void result.current.handleWhiteboardCommit([rect('old')], [], 1); });
    // Someone started a new board while the retry waited; this person draws on it.
    await act(async () => { void result.current.handleWhiteboardCommit([rect('new')], [], 2); });

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(2);
    const retried = save.mock.calls[1][0];
    expect(retried.generation).toBe(2);
    expect(retried.elements.map((el: WhiteboardElement) => el.id)).toEqual(['new']);
    expect(retried.edit.addedIds).toEqual(['new']);
  });

  it('drops an edit the server rejected on its merits instead of retrying it forever', async () => {
    save.mockRejectedValueOnce(new ConvexError('Too many whiteboard elements')).mockResolvedValue({});
    const { result } = renderHook(() => useWhiteboardSync('room', 'token'));

    await act(async () => { void result.current.handleWhiteboardCommit([rect('a')], [], 1); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.whiteboardError).not.toBeNull();
  });

  it('tells the board once everything it sent is saved: after queued changes and retries, or when the server refused them', async () => {
    let finish!: () => void;
    save.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); }))
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockRejectedValueOnce(new ConvexError('Too many whiteboard elements'))
      .mockResolvedValue({});
    const { result } = renderHook(() => useWhiteboardSync('room', 'token'));
    const saved: string[] = [];
    const a = rect('a');
    const b = rect('b', 20);

    await act(async () => { void result.current.handleWhiteboardCommit([a], [], 1)?.then(() => saved.push('a')); });
    // Drawn while the first save is on its way: it waits in the queue.
    await act(async () => { void result.current.handleWhiteboardCommit([a, b], [a], 1)?.then(() => saved.push('b')); });
    expect(saved).toEqual([]);

    // The first save lands, the queued one fails on the connection and waits for its retry.
    await act(async () => { finish(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(saved).toEqual([]);

    // The retry is refused for good: nothing of this board is on its way any more.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(3);
    expect(saved).toEqual(['a', 'b']);
  });
});

