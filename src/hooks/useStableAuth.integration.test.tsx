import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionState: { data: any; isPending: boolean } = {
  data: null,
  isPending: false,
};

const convexAuthState: { isLoading: boolean; isAuthenticated: boolean } = {
  isLoading: false,
  isAuthenticated: false,
};

vi.mock('../lib/authClient', () => ({
  authClient: {
    useSession: () => sessionState,
  },
}));

vi.mock('convex/react', () => ({
  useConvexAuth: () => convexAuthState,
}));

import { useStableAuth } from './useStableAuth';

describe('useStableAuth', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionState.data = null;
    sessionState.isPending = false;
    convexAuthState.isLoading = false;
    convexAuthState.isAuthenticated = false;
  });

  it('preserves authenticated state during transient loading grace window', () => {
    sessionStorage.setItem('tavio:lastAuthState', 'true');
    sessionState.isPending = true;
    convexAuthState.isLoading = true;

    const { result } = renderHook(() => useStableAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isTransient).toBe(true);
  });

  it('settles to unauthenticated state after loading completes', async () => {
    const { result } = renderHook(() => useStableAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isTransient).toBe(false);
  });
});
