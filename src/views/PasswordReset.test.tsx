import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppView } from '../types';

const { resetPasswordMock } = vi.hoisted(() => ({
  resetPasswordMock: vi.fn(),
}));

vi.mock('../lib/authClient', () => ({
  authClient: {
    resetPassword: resetPasswordMock,
  },
}));

vi.mock('@lingui/react', () => ({
  useLingui: () => ({
    _: (value: any) => {
      if (typeof value === 'string') return value;
      return value?.message ?? value?.id ?? '';
    },
  }),
}));

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The desk's top bar needs the real i18n instance, which the mock above leaves out.
vi.mock('../components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));

import { PasswordReset } from './PasswordReset';

describe('PasswordReset', () => {
  const fillPasswords = async (
    user: ReturnType<typeof userEvent.setup>,
    container: HTMLElement,
    password: string,
    confirmPassword: string
  ) => {
    const inputs = container.querySelectorAll('input[type="password"]');
    await user.type(inputs[0] as HTMLInputElement, password);
    await user.type(inputs[1] as HTMLInputElement, confirmPassword);
  };

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    resetPasswordMock.mockReset();
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/');
    vi.useRealTimers();
  });

  it('shows invalid token error when token is missing', async () => {
    render(<PasswordReset onNavigate={vi.fn()} />);

    expect(
      await screen.findByText('Invalid or missing reset token. Please request a new password reset.')
    ).toBeInTheDocument();
  });

  it('validates password strength before submitting', async () => {
    const user = userEvent.setup();
    const { container } = render(<PasswordReset token="valid-token-123" onNavigate={vi.fn()} />);

    await fillPasswords(user, container, 'weakpass1', 'weakpass1');
    await user.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);

    expect(await screen.findByText('Password must contain at least one uppercase letter')).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('validates password confirmation mismatch', async () => {
    const user = userEvent.setup();
    const { container } = render(<PasswordReset token="valid-token-123" onNavigate={vi.fn()} />);

    await fillPasswords(user, container, 'ValidPass1', 'ValidPass2');
    await user.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('submits reset and auto-navigates to auth after success', async () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    resetPasswordMock.mockResolvedValue({});

    const { container } = render(<PasswordReset token="valid-token-123" onNavigate={onNavigate} />);
    const inputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'ValidPass1' } });
    fireEvent.change(inputs[1], { target: { value: 'ValidPass1' } });

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
      await Promise.resolve();
    });

    expect(resetPasswordMock).toHaveBeenCalledWith({
      token: 'valid-token-123',
      newPassword: 'ValidPass1',
    });

    expect(screen.getByText('Password Reset Successful')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onNavigate).toHaveBeenCalledWith(AppView.AUTH);
  });

  it('shows backend reset error message', async () => {
    vi.useFakeTimers();
    resetPasswordMock.mockResolvedValue({ error: { message: 'Token expired' } });

    const { container } = render(<PasswordReset token="valid-token-123" onNavigate={vi.fn()} />);
    const inputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0], { target: { value: 'ValidPass1' } });
    fireEvent.change(inputs[1], { target: { value: 'ValidPass1' } });

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
      await Promise.resolve();
    });

    expect(screen.getByText('Token expired')).toBeInTheDocument();
  });
});
