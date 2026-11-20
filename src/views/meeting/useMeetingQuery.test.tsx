import React from 'react';
import { renderHook } from '@testing-library/react';
import { useQueries } from 'convex/react';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOM_ACCESS_REQUIRED } from '../../../convex/lib/roomIdentity';

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('convex/react', () => ({ useQueries: vi.fn() }));

import { useMeetingQuery } from './useMeetingQuery';

const query = 'chat:list' as any;

describe('useMeetingQuery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns data and a failed query, so one region failing leaves the call running', () => {
    vi.mocked(useQueries).mockReturnValue({ result: ['message'] });
    expect(renderHook(() => useMeetingQuery(query, {})).result.current).toEqual(['message']);

    const failure = new Error('network');
    vi.mocked(useQueries).mockReturnValue({ result: failure });
    expect(renderHook(() => useMeetingQuery(query, {})).result.current).toBe(failure);
  });

  it('throws revoked room access, which the access boundary handles', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const revoked = new ConvexError({ code: ROOM_ACCESS_REQUIRED, message: 'x' });
    vi.mocked(useQueries).mockReturnValue({ result: revoked });

    expect(() => renderHook(() => useMeetingQuery(query, {}))).toThrow(revoked);
  });
});
