import { describe, expect, it, vi } from 'vitest';
import { buildAudioCaptureOptions, getNoiseReductionSupport } from './audioCapture';

describe('audioCapture helpers', () => {
  it('builds sensible defaults when supported constraints API is unavailable', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {},
    });

    expect(buildAudioCaptureOptions({ noiseReductionEnabled: true })).toEqual({
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    });
  });

  it('includes voiceIsolation when browser reports support', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getSupportedConstraints: vi.fn(() => ({
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
          voiceIsolation: true,
        })),
      },
    });

    expect(buildAudioCaptureOptions({ noiseReductionEnabled: false })).toEqual({
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: false,
      voiceIsolation: false,
    });
  });

  it('reports no noise support when browser says both constraints are unsupported', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getSupportedConstraints: vi.fn(() => ({
          noiseSuppression: false,
          voiceIsolation: false,
        })),
      },
    });

    expect(getNoiseReductionSupport()).toEqual({
      supported: false,
      voiceIsolationSupported: false,
    });
  });
});
