import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useLocalParticipant, useMediaDeviceSelect } from '@livekit/components-react';
import { type LocalVideoTrack, TrackEvent, VideoPresets } from 'livekit-client';

export interface CameraSwitch {
  canSwitch: boolean;
  isRearCamera: boolean;
  switching: boolean;
  failed: boolean;
  switchCamera: () => Promise<void>;
}

const FAILURE_NOTICE_MS = 5000;

export function useCameraSwitch(): CameraSwitch {
  const { cameraTrack, isCameraEnabled } = useLocalParticipant();
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind: 'videoinput' });
  const track = cameraTrack?.videoTrack as LocalVideoTrack | undefined;
  const [switching, setSwitching] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const [, refresh] = useReducer((count: number) => count + 1, 0);

  // The new camera is a new MediaStreamTrack, and its facing is only known from that one.
  useEffect(() => {
    if (!track) return undefined;
    track.on(TrackEvent.Restarted, refresh);
    return () => { track.off(TrackEvent.Restarted, refresh); };
  }, [track]);

  const facing = track?.mediaStreamTrack.getSettings().facingMode;
  const knowsFacing = facing === 'user' || facing === 'environment';
  const isRearCamera = facing === 'environment';

  useEffect(() => {
    if (!failed) return undefined;
    const timer = window.setTimeout(() => setFailed(false), FAILURE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [failed]);

  const switchCamera = useCallback(async () => {
    if (!track || busy.current) return;
    busy.current = true;
    setSwitching(true);
    setFailed(false);
    try {
      if (knowsFacing) {
        // Phones list many lenses, so the next device in the list is often on the same side.
        await track.restartTrack({
          facingMode: isRearCamera ? 'user' : 'environment',
          resolution: VideoPresets.h720.resolution,
        });
      } else {
        const current = devices.findIndex((device) => device.deviceId === activeDeviceId);
        const next = devices[(current + 1) % devices.length];
        if (next) await setActiveMediaDevice(next.deviceId);
      }
      refresh();
    } catch (error) {
      console.error('Unable to switch camera', error);
      setFailed(true);
    } finally {
      busy.current = false;
      setSwitching(false);
    }
  }, [track, knowsFacing, isRearCamera, devices, activeDeviceId, setActiveMediaDevice]);

  return { canSwitch: isCameraEnabled && devices.length >= 2, isRearCamera, switching, failed, switchCamera };
}
