import { useEffect, useState } from 'react';
import { ConnectionQuality } from 'livekit-client';

// Most reconnects finish within a second and media keeps flowing; only a longer one is worth a notice.
export const RECONNECT_NOTICE_DELAY_MS = 1500;
// LiveKit's quality score dips for a moment on any burst of loss; a weak link has to last before it is named.
export const POOR_QUALITY_SETTLE_MS = 3000;

/** True once `active` has held for `delayMs`; false again as soon as it ends. */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && elapsed;
}

const isWeak = (quality: ConnectionQuality) => quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost;

/** Reports a weak connection only after it lasted `settleMs`; a recovery shows at once. */
export function useSettledQuality(quality: ConnectionQuality, settleMs: number = POOR_QUALITY_SETTLE_MS): ConnectionQuality {
  const [settled, setSettled] = useState(quality);
  useEffect(() => {
    if (!isWeak(quality)) {
      setSettled(quality);
      return;
    }
    const timer = setTimeout(() => setSettled(quality), settleMs);
    return () => clearTimeout(timer);
  }, [quality, settleMs]);
  return settled;
}
