import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
const mockUseStableAuth = vi.fn();

vi.mock('../hooks/useStableAuth', () => ({
  useStableAuth: () => mockUseStableAuth(),
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate }),
}));

import { AuthGuard } from './AuthGuard';

describe('AuthGuard', () => {
  beforeEach(() => {
    navigate.mockReset();
    mockUseStableAuth.mockReset();
  });

  it('renders fallback during transient loading state', () => {
    mockUseStableAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
      isTransient: true,
    });

    render(
      <AuthGuard fallback={<div>Loading auth...</div>}>
        <div>Protected</div>
      </AuthGuard>
    );

    expect(screen.getByText('Loading auth...')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows a labelled spinner on the desk when no fallback is given', () => {
    mockUseStableAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
      isTransient: true,
    });

    render(
      <AuthGuard>
        <div>Protected</div>
      </AuthGuard>
    );

    expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users after auth settles', async () => {
    mockUseStableAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      isTransient: false,
    });

    render(
      <AuthGuard>
        <div>Protected</div>
      </AuthGuard>
    );

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({ to: '/auth/login' });
    });
  });
});
