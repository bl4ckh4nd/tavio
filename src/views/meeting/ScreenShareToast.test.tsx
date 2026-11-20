import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trackState = vi.hoisted(() => ({ tracks: [] as Array<{ participant: { name: string } }> }));

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@livekit/components-react', () => ({ useTracks: () => trackState.tracks }));
vi.mock('livekit-client', () => ({ Track: { Source: { ScreenShare: 'screen_share' } } }));

import { ScreenShareToast } from './ScreenShareToast';

const SHARING = [{ participant: { name: 'Ava' } }];

describe('ScreenShareToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    trackState.tracks = [];
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('names who started sharing and goes away after three seconds', () => {
    const { rerender } = render(<ScreenShareToast />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    trackState.tracks = SHARING;
    rerender(<ScreenShareToast />);
    expect(screen.getByRole('status')).toHaveTextContent('Ava');

    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not stay behind when sharing stops within those three seconds', () => {
    const { rerender } = render(<ScreenShareToast />);
    trackState.tracks = SHARING;
    rerender(<ScreenShareToast />);
    act(() => { vi.advanceTimersByTime(1000); });

    trackState.tracks = [];
    rerender(<ScreenShareToast />);
    act(() => { vi.advanceTimersByTime(5000); });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
