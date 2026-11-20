import React from 'react';
import { Trans } from '@lingui/react/macro';
import { ConvexError } from 'convex/values';
import { Button } from '../../components/ui';
import { ROOM_ACCESS_REQUIRED } from '../../../convex/lib/roomIdentity';

export const isRoomAccessError = (error: unknown) =>
  error instanceof ConvexError && (error.data as { code?: string } | undefined)?.code === ROOM_ACCESS_REQUIRED;

type Props = { children: React.ReactNode; onRejoin: () => void };

/** Room queries throw once access is revoked, e.g. after a password change. */
export class MeetingAccessBoundary extends React.Component<Props, { error: unknown }> {
  declare props: Readonly<Props>;
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (!isRoomAccessError(this.state.error)) throw this.state.error;
    return (
      <div className="g-board flex h-[100dvh] w-full items-center justify-center p-4">
        <div role="alert" className="dialog stock stock--lift">
          <h2 className="dialog__title"><Trans>Your access to this room has changed</Trans></h2>
          <p>
            <Trans>The room's access settings were updated, so you have left the meeting. Join again to continue.</Trans>
          </p>
          <div className="dialog__actions">
            <Button onClick={this.props.onRejoin}>
              <Trans>Join again</Trans>
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
