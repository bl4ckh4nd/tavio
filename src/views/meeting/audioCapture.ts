import type { AudioCaptureOptions } from 'livekit-client';

export const NOISE_REDUCTION_STORAGE_KEY = 'tavio.audio.noiseReductionEnabled';

type AudioConstraintSupport = {
  autoGainControl: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  voiceIsolation: boolean;
};

function readSupportedAudioConstraints(): AudioConstraintSupport {
  const supportsConstraintQuery =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getSupportedConstraints === 'function';
  if (!supportsConstraintQuery) {
    return {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
      voiceIsolation: false,
    };
  }

  const supported = navigator.mediaDevices.getSupportedConstraints();
  const supportedRecord = supported as Record<string, unknown>;
  return {
    autoGainControl: supported.autoGainControl === true,
    echoCancellation: supported.echoCancellation === true,
    noiseSuppression: supported.noiseSuppression === true,
    voiceIsolation: supportedRecord.voiceIsolation === true,
  };
}

export function getNoiseReductionSupport(): { supported: boolean; voiceIsolationSupported: boolean } {
  if (typeof navigator === 'undefined') {
    return { supported: false, voiceIsolationSupported: false };
  }
  const constraintSupport = readSupportedAudioConstraints();
  return {
    supported: constraintSupport.noiseSuppression || constraintSupport.voiceIsolation,
    voiceIsolationSupported: constraintSupport.voiceIsolation,
  };
}

export function readNoiseReductionPreference(defaultValue = true): boolean {
  if (typeof window === 'undefined') return defaultValue;
  const raw = window.localStorage.getItem(NOISE_REDUCTION_STORAGE_KEY);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return defaultValue;
}

export function writeNoiseReductionPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NOISE_REDUCTION_STORAGE_KEY, String(enabled));
}

type BuildAudioCaptureOptionsArgs = {
  noiseReductionEnabled: boolean;
  deviceId?: string;
};

export function buildAudioCaptureOptions({
  noiseReductionEnabled,
  deviceId,
}: BuildAudioCaptureOptionsArgs): AudioCaptureOptions {
  const options: AudioCaptureOptions = {};
  const support = readSupportedAudioConstraints();

  if (deviceId) {
    options.deviceId = { exact: deviceId };
  }
  if (support.autoGainControl) {
    options.autoGainControl = true;
  }
  if (support.echoCancellation) {
    options.echoCancellation = true;
  }
  if (support.noiseSuppression) {
    options.noiseSuppression = noiseReductionEnabled;
  }
  if (support.voiceIsolation) {
    options.voiceIsolation = noiseReductionEnabled;
  }

  return options;
}
