import { describe, expect, it } from 'vitest';
import { getJoinMediaPublishConfig } from './joinMedia';

describe('getJoinMediaPublishConfig', () => {
  it('publishes audio and video when user is not muted and camera is on', () => {
    expect(getJoinMediaPublishConfig({ isMuted: false, isCameraOff: false })).toEqual({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: true,
    });
  });

  it('disables audio publish when user joins muted', () => {
    expect(getJoinMediaPublishConfig({ isMuted: true, isCameraOff: false })).toEqual({
      audio: false,
      video: true,
    });
  });

  it('disables video publish when camera is off', () => {
    expect(getJoinMediaPublishConfig({ isMuted: false, isCameraOff: true })).toEqual({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  });

  it('disables noise suppression when preference is off', () => {
    expect(
      getJoinMediaPublishConfig({
        isMuted: false,
        isCameraOff: false,
        noiseReductionEnabled: false,
      }),
    ).toEqual({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: false,
      },
      video: true,
    });
  });

  it('passes audio input device constraint when provided', () => {
    expect(
      getJoinMediaPublishConfig({
        isMuted: false,
        isCameraOff: false,
        audioInputDeviceId: 'mic-123',
      }),
    ).toEqual({
      audio: {
        deviceId: { exact: 'mic-123' },
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: true,
    });
  });
});
