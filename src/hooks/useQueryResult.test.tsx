import React from 'react';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { ConvexProvider, type ConvexReactClient } from 'convex/react';
import { anyApi } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQueryResult, withoutError } from './useQueryResult';

// The real useQueries over a stand-in client, because a mocked one cannot show a render loop.
const clientWith = (result: () => unknown) => {
  const watchQuery = vi.fn(() => ({
    onUpdate: () => () => {},
    localQueryResult: result,
    journal: () => undefined,
  }));
  return { client: { watchQuery } as unknown as ConvexReactClient, watchQuery };
};

const provider = (client: ConvexReactClient) => ({ children }: { children: React.ReactNode }) => (
  <ConvexProvider client={client}>{children}</ConvexProvider>
);

describe('useQueryResult', () => {
  afterEach(cleanup);

  it('settles when each render reads the query reference anew', () => {
    const { client } = clientWith(() => ['room']);
    let renders = 0;
    const Rooms = () => {
      renders += 1;
      return <p>{String(useQueryResult(anyApi.rooms.list, {}))}</p>;
    };

    const { rerender } = render(<Rooms />, { wrapper: provider(client) });
    rerender(<Rooms />);

    expect(screen.getByText('room')).toBeInTheDocument();
    expect(renders).toBeLessThan(6);
  });

  it('returns a failed query as an Error instead of throwing it', () => {
    const failure = new Error('query failed');
    const { client } = clientWith(() => { throw failure; });

    const { result } = renderHook(() => useQueryResult(anyApi.rooms.list, {}), { wrapper: provider(client) });

    expect(result.current).toBe(failure);
    expect(withoutError(result.current)).toBeUndefined();
  });

  it('does not ask for a skipped query', () => {
    const { client, watchQuery } = clientWith(() => ['room']);

    const { result } = renderHook(() => useQueryResult(anyApi.rooms.list, 'skip'), { wrapper: provider(client) });

    expect(result.current).toBeUndefined();
    expect(watchQuery).not.toHaveBeenCalled();
  });
});
