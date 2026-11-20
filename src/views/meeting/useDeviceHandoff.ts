import { useCallback, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';

// A short code that moves this seat in the meeting to another device.
export const useDeviceHandoff = ({
  roomId,
  sessionCredential,
  currentBreakoutRoomId,
  currentLivekitRoomName,
}: {
  roomId: string | undefined;
  sessionCredential: string | undefined;
  currentBreakoutRoomId: string | null;
  currentLivekitRoomName: string;
}) => {
  const createHandoff = useAction(api.deviceHandoffs.create);
  const cancelHandoff = useAction(api.deviceHandoffs.cancel);
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffCode, setHandoffCode] = useState<string | null>(null);
  const [handoffExpiresAt, setHandoffExpiresAt] = useState<number | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  const createDeviceHandoff = useCallback(async () => {
    if (!roomId || !sessionCredential) return;
    setHandoffLoading(true);
    setHandoffError(null);
    try {
      const result: any = await createHandoff({
        credential: sessionCredential,
        roomId: roomId as any,
        currentRoomId: currentBreakoutRoomId ?? 'main',
        currentLivekitRoomName,
      });
      setHandoffCode(result.code);
      setHandoffExpiresAt(result.expiresAt);
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : 'Unable to create a device handoff link.');
    } finally {
      setHandoffLoading(false);
    }
  }, [createHandoff, currentBreakoutRoomId, currentLivekitRoomName, roomId, sessionCredential]);

  const cancelDeviceHandoff = useCallback(async () => {
    let cancelled = true;
    if (roomId && sessionCredential && handoffCode) {
      try {
        await cancelHandoff({ credential: sessionCredential, code: handoffCode, roomId: roomId as any });
      } catch (error) {
        cancelled = false;
        setHandoffError(error instanceof Error ? error.message : 'Unable to cancel the handoff link.');
      }
    }
    if (cancelled) {
      setHandoffCode(null);
      setHandoffExpiresAt(null);
    }
  }, [cancelHandoff, handoffCode, roomId, sessionCredential]);

  const openDeviceHandoff = useCallback(() => {
    setShowHandoff(true);
    if (!handoffCode) void createDeviceHandoff();
  }, [createDeviceHandoff, handoffCode]);

  return {
    showHandoff,
    closeHandoff: () => setShowHandoff(false),
    handoffCode,
    handoffExpiresAt,
    handoffLoading,
    handoffError,
    createDeviceHandoff,
    cancelDeviceHandoff,
    openDeviceHandoff,
  };
};
