import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lingui/core/macro', () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, part, idx) => `${acc}${part}${values[idx] ?? ''}`, ''),
}));

import { ToastProvider, useToast, TOAST_EXIT_MS, TOAST_TIMEOUT_MS } from './ToastProvider';

const Harness: React.FC<{ variant: 'success' | 'error' | 'info'; message: string }> = ({ variant, message }) => {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast[variant](message)}>
      push
    </button>
  );
};

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

const push = (message: string) => {
  act(() => {
    screen.getByRole('button', { name: 'push' }).click();
  });
};

describe('ToastProvider lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps a toast on screen while the document is hidden and expires it after the tab returns', () => {
    render(
      <ToastProvider>
        <Harness variant="info" message="Saved" />
      </ToastProvider>
    );

    push('Saved');
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => setVisibility('hidden'));
    act(() => { vi.advanceTimersByTime(TOAST_TIMEOUT_MS * 3); });
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => setVisibility('visible'));
    act(() => { vi.advanceTimersByTime(TOAST_TIMEOUT_MS); });
    // Exit state, still mounted until the exit transition finishes.
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('holds a toast while it is hovered and resumes the remaining time on pointer leave', () => {
    render(
      <ToastProvider>
        <Harness variant="success" message="Room created" />
      </ToastProvider>
    );

    push('Room created');
    const toast = screen.getByText('Room created').parentElement!;

    act(() => { vi.advanceTimersByTime(TOAST_TIMEOUT_MS - 500); });
    act(() => { toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(TOAST_TIMEOUT_MS * 2); });
    expect(screen.getByText('Room created')).toBeInTheDocument();

    act(() => { toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });
    expect(screen.queryByText('Room created')).not.toBeInTheDocument();
  });

  it('stays paused until both hover and keyboard focus have left', () => {
    render(
      <ToastProvider>
        <Harness variant="info" message="Invite copied" />
      </ToastProvider>
    );

    push('Invite copied');
    const toast = screen.getByText('Invite copied').parentElement!;
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });

    act(() => { vi.advanceTimersByTime(TOAST_TIMEOUT_MS - 500); });
    fireEvent.mouseEnter(toast);
    fireEvent.focus(dismiss);
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(TOAST_TIMEOUT_MS); });
    expect(screen.getByText('Invite copied')).toBeInTheDocument();

    fireEvent.blur(dismiss, { relatedTarget: document.body });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });
    expect(screen.queryByText('Invite copied')).not.toBeInTheDocument();
  });

  it('announces errors as alerts and everything else as status', () => {
    render(
      <ToastProvider>
        <Harness variant="error" message="Upload failed" />
      </ToastProvider>
    );

    push('Upload failed');
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows only the server message of a Convex error, without request id, stack, or file paths', () => {
    const devError = '[CONVEX M(rooms:update)] [Request ID: 22f3a806b7dda4c0] Server Error\nUncaught Error: A password is required for password-protected rooms\n    at handler (../convex/rooms.ts:515:14)\n\n  Called by client';
    const prodError = '[CONVEX M(rooms:update)] [Request ID: 22f3a806b7dda4c0] Server Error\n  Called by client';
    render(
      <ToastProvider>
        <Harness variant="error" message={devError} />
        <Harness variant="error" message={prodError} />
      </ToastProvider>
    );

    act(() => {
      screen.getAllByRole('button', { name: 'push' }).forEach((button) => button.click());
    });
    const [devAlert, prodAlert] = screen.getAllByRole('alert');
    expect(devAlert).toHaveTextContent(/^A password is required for password-protected roomsDismiss$/);
    expect(prodAlert).toHaveTextContent(/^Something went wrong\. Please try again\.Dismiss$/);
  });
});
