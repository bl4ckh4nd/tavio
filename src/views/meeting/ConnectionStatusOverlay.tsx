import React, { useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { useConnectionState, useRoomContext } from '@livekit/components-react';
import { useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { ConnectionState, DisconnectReason, RoomEvent } from 'livekit-client';
import { Button } from '../../components/ui';
import type { MeetingEndReason } from '../../types';
import { RECONNECT_NOTICE_DELAY_MS, useDelayedFlag } from './connectionSignals';

export interface ConnectionStatusOverlayProps {
  darkMode: boolean;
  onLeave: (reason?: MeetingEndReason) => void;
  roomId?: string;
  sessionCredential?: string;
  currentRoomId?: string;
  onTransferred?: () => void;
}

export const ConnectionStatusOverlay: React.FC<ConnectionStatusOverlayProps> = ({ onLeave, roomId, sessionCredential, currentRoomId = 'main', onTransferred }) => {
  const room = useRoomContext();
  const state = useConnectionState(room);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const previous = useRef<ConnectionState | null>(null);
  const issueReconnectToken = useAction(api.breakoutActions.issueReconnectToken);
  const [rejoining, setRejoining] = useState(false);
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const [disconnectReason, setDisconnectReason] = useState<DisconnectReason | undefined>();

  useEffect(() => {
    const onDisconnected = (reason?: DisconnectReason) => setDisconnectReason(reason);
    const onConnected = () => setDisconnectReason(undefined);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.Connected, onConnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.Connected, onConnected);
    };
  }, [room]);

  // The host closed the LiveKit room: this is not a network fault, so route to
  // the endscreen instead of offering a reconnect.
  useEffect(() => {
    if (disconnectReason === DisconnectReason.ROOM_DELETED) {
      onLeave('host_ended');
    }
  }, [disconnectReason, onLeave]);

  useEffect(() => {
    if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
      if (previous.current !== state) {
        setReconnectAttempts((prev) => prev + 1);
      }
    }
    if (state === ConnectionState.Connected) {
      setReconnectAttempts(0);
    }
    previous.current = state;
  }, [state]);

  const handleReconnect = async () => {
    if (!roomId || !sessionCredential) return;
    setRejoining(true);
    setRejoinError(null);
    try {
      const result: any = await issueReconnectToken({
        credential: sessionCredential,
        roomId: roomId as any,
        currentRoomId,
      });
      if (!result?.token || !result.url) throw new Error(t`Unable to reconnect.`)
      await room.connect(result.url, result.token)
    } catch (error) {
      setRejoinError(error instanceof Error ? error.message : t`Unable to reconnect.`)
    } finally {
      setRejoining(false)
    }
  };

  // A signal reconnect keeps media flowing, so it gets a toast; a media reconnect blocks the call, so it
  // gets the dialog. Both wait a moment, because most reconnects end before anyone would notice.
  const showSignalNotice = useDelayedFlag(state === ConnectionState.SignalReconnecting, RECONNECT_NOTICE_DELAY_MS);
  const showReconnectDialog = useDelayedFlag(state === ConnectionState.Reconnecting, RECONNECT_NOTICE_DELAY_MS);

  if (showSignalNotice) {
    return (
      <div role="status" className="toast mtoast entry-fade">
        <span className="spin" aria-hidden="true" />
        <Trans>Reconnecting...</Trans>
      </div>
    );
  }

  if (showReconnectDialog) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim p-4 entry-fade">
        <div role="alertdialog" aria-live="polite" aria-labelledby="connection-title" className="dialog stock stock--lift">
          <div className="flex items-center gap-2">
            <span className="spin" aria-hidden="true" />
            <h2 id="connection-title" className="dialog__title"><Trans>Reconnecting...</Trans></h2>
          </div>
          <p><Trans>Attempting to reconnect...</Trans></p>
          {reconnectAttempts > 1 && (
            <p className="muted text-xs">
              <Trans>Reconnection attempt {reconnectAttempts}</Trans>
            </p>
          )}
        </div>
      </div>
    );
  }

  if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) return null;

  if (state === ConnectionState.Disconnected) {
    if (disconnectReason === DisconnectReason.ROOM_DELETED) return null;
    if (disconnectReason === DisconnectReason.DUPLICATE_IDENTITY) {
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim p-4">
          <div role="alertdialog" aria-labelledby="connection-title" className="dialog stock stock--lift">
            <h2 id="connection-title" className="dialog__title"><Trans>Meeting moved to another device</Trans></h2>
            <p><Trans>This device is no longer connected. You can close this meeting.</Trans></p>
            <div className="dialog__actions">
              <Button onClick={() => (onTransferred ? onTransferred() : onLeave())}><Trans>Close</Trans></Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim p-4 entry-fade">
        <div role="alertdialog" aria-labelledby="connection-title" className="dialog stock stock--lift">
          <h2 id="connection-title" className="dialog__title"><Trans>Connection Lost</Trans></h2>
          <p><Trans>You have been disconnected from the meeting. Please check your internet connection.</Trans></p>
          {rejoinError && <p role="alert" className="notice notice--error">{rejoinError}</p>}
          <div className="dialog__actions flex-wrap">
            <Button variant="secondary" onClick={() => onLeave()}>
              <Trans>Leave</Trans>
            </Button>
            <Button onClick={handleReconnect} disabled={rejoining || !sessionCredential}>
              {rejoining ? <Trans>Reconnecting...</Trans> : <Trans>Reconnect</Trans>}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
