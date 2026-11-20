import { User } from '../../types';
import type { AudioCaptureOptions } from 'livekit-client';
import { buildAudioCaptureOptions } from './audioCapture';

export interface JoinMediaPublishConfig {
  audio: AudioCaptureOptions | boolean;
  video: boolean;
}

export function getJoinMediaPublishConfig(
  user: Pick<User, 'isMuted' | 'isCameraOff'> & {
    noiseReductionEnabled?: boolean;
    audioInputDeviceId?: string;
  },
): JoinMediaPublishConfig {
  const noiseReductionEnabled = user.noiseReductionEnabled ?? true;
  return {
    audio: user.isMuted
      ? false
      : buildAudioCaptureOptions({
          noiseReductionEnabled,
          deviceId: user.audioInputDeviceId,
        }),
    video: !user.isCameraOff,
  };
}
