import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_ACCESS_REQUIRED } from '../../../convex/lib/roomIdentity';

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/ui', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}));

import { MeetingAccessBoundary } from './MeetingAccessBoundary';

const Throws = ({ error }: { error: unknown }): React.ReactElement => {
  throw error;
};

describe('MeetingAccessBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('offers to join again when room access was revoked', () => {
    const onRejoin = vi.fn();
    render(
      <MeetingAccessBoundary onRejoin={onRejoin}>
        <Throws error={new ConvexError({ code: ROOM_ACCESS_REQUIRED, message: 'x' })} />
      </MeetingAccessBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(onRejoin).toHaveBeenCalledTimes(1);
  });

  it('does not hide unrelated errors', () => {
    expect(() =>
      render(
        <MeetingAccessBoundary onRejoin={vi.fn()}>
          <Throws error={new Error('boom')} />
        </MeetingAccessBoundary>,
      ),
    ).toThrow('boom');
  });

  it('renders children while nothing is wrong', () => {
    render(<MeetingAccessBoundary onRejoin={vi.fn()}><p>meeting</p></MeetingAccessBoundary>);
    expect(screen.getByText('meeting')).toBeTruthy();
  });
});
