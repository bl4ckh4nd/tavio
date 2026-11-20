import React, { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { useLocalParticipant } from '@livekit/components-react';
import { LocalAudioTrack, LocalVideoTrack, type AudioCaptureOptions } from 'livekit-client';
import { BackgroundProcessor } from '@livekit/track-processors';
import { BACKGROUND_PROCESSOR_ASSETS, toBackgroundProcessorOptions } from './backgroundProcessorOptions';
import { hasBackgroundProcessorSupport } from './backgroundProcessorSupport';

type BackgroundProcessorEngine = 'none' | 'livekit';

export interface BackgroundProcessorDebugInfo {
  support: boolean;
  hasLocalParticipant: boolean;
  hasCameraTrack: boolean;
  activeMode: string;
  selectedEngine: BackgroundProcessorEngine;
  fallbackReason: string;
  avgInferenceMs: number;
  effectiveFps: number;
  lastError: string;
}

export const DEFAULT_BACKGROUND_PROCESSOR_DEBUG_INFO: BackgroundProcessorDebugInfo = {
  support: false,
  hasLocalParticipant: false,
  hasCameraTrack: false,
  activeMode: 'none',
  selectedEngine: 'none',
  fallbackReason: '',
  avgInferenceMs: 0,
  effectiveFps: 0,
  lastError: '',
};

type SwitchableBackgroundProcessor = ReturnType<typeof BackgroundProcessor>;

// Custom hook for LiveKit's background processor lifecycle. The processor is
// attached once per camera track only when an effect is selected, then effect
// changes use switchTo so rapid changes do not replace the published track.
const useBackgroundProcessor = (virtualBackground: string) => {
  const { localParticipant, cameraTrack } = useLocalParticipant();
  const cameraLocalTrack = cameraTrack?.track as LocalVideoTrack | undefined;
  const sourceSettings = cameraLocalTrack?.getSourceTrackSettings();
  const cameraSourceKey = cameraLocalTrack
    ? `${sourceSettings?.deviceId ?? cameraTrack?.trackSid ?? ''}:${sourceSettings?.width ?? ''}x${sourceSettings?.height ?? ''}`
    : null;
  const cameraTrackSid = cameraTrack?.trackSid;
  const backgroundProcessingSupported = hasBackgroundProcessorSupport();
  const processorRef = useRef<SwitchableBackgroundProcessor | null>(null);
  const processorTrackRef = useRef<LocalVideoTrack | null>(null);
  const processorSourceKeyRef = useRef<string | null>(null);
  const processorModeRef = useRef<string | null>(null);
  const operationRef = useRef<Promise<void>>(Promise.resolve());
  const requestVersionRef = useRef(0);
  const disposedRef = useRef(false);
  const processingTimesRef = useRef<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processorError, setProcessorError] = useState<string | null>(null);
  const [processorDebugInfo, setProcessorDebugInfo] = useState<BackgroundProcessorDebugInfo>(() => ({
    ...DEFAULT_BACKGROUND_PROCESSOR_DEBUG_INFO,
    support: backgroundProcessingSupported,
  }));

  const updateProcessingStats = useCallback((processingTimeMs: number) => {
    const samples = [...processingTimesRef.current, processingTimeMs].slice(-45);
    processingTimesRef.current = samples;
    const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const fps = avg > 0 ? Math.min(60, 1000 / avg) : 0;
    setProcessorDebugInfo((prev) => ({
      ...prev,
      avgInferenceMs: Number.isFinite(avg) ? Number(avg.toFixed(2)) : 0,
      effectiveFps: Number.isFinite(fps) ? Number(fps.toFixed(1)) : 0,
    }));
  }, []);

  const applyProcessor = useCallback(() => {
    const requestVersion = ++requestVersionRef.current;
    const requestedTrack = cameraLocalTrack;
    const requestedSourceKey = cameraSourceKey;
    const requestedMode = virtualBackground;

    const operation = async () => {
      if (disposedRef.current || requestVersion !== requestVersionRef.current) return;

      setIsProcessing(true);
      setProcessorError(null);
      processingTimesRef.current = [];
      setProcessorDebugInfo((prev) => ({
        ...prev,
        support: backgroundProcessingSupported,
        hasLocalParticipant: !!localParticipant,
        hasCameraTrack: !!requestedTrack,
        activeMode: requestedMode,
        fallbackReason: '',
        avgInferenceMs: 0,
        effectiveFps: 0,
        lastError: '',
      }));

      try {
        if (!localParticipant || !requestedTrack) {
          if (processorTrackRef.current) {
            await processorTrackRef.current.stopProcessor().catch(() => {});
            processorRef.current = null;
            processorTrackRef.current = null;
            processorSourceKeyRef.current = null;
            processorModeRef.current = null;
          }
          if (requestVersion === requestVersionRef.current) {
            setProcessorDebugInfo((prev) => ({ ...prev, hasCameraTrack: false }));
          }
          return;
        }
        if (requestedMode === 'none') {
          if (processorTrackRef.current) {
            await processorTrackRef.current.stopProcessor().catch(() => {});
            processorRef.current = null;
            processorTrackRef.current = null;
            processorSourceKeyRef.current = null;
            processorModeRef.current = null;
          }
          if (requestVersion === requestVersionRef.current) {
            setProcessorDebugInfo((prev) => ({
              ...prev,
              selectedEngine: 'none',
              activeMode: 'none',
            }));
          }
          return;
        }
        if (!backgroundProcessingSupported) {
          throw new Error(t`Background effects are not supported in this browser.`);
        }

        const sameTrack = processorTrackRef.current === requestedTrack
          && processorSourceKeyRef.current === requestedSourceKey
          && processorRef.current;
        if (!sameTrack) {
          if (processorTrackRef.current) {
            await processorTrackRef.current.stopProcessor().catch(() => {});
            processorRef.current = null;
            processorTrackRef.current = null;
            processorSourceKeyRef.current = null;
            processorModeRef.current = null;
          }
          const processor = BackgroundProcessor({
            mode: 'disabled',
            assetPaths: BACKGROUND_PROCESSOR_ASSETS,
            onFrameProcessed: ({ processingTimeMs }) => updateProcessingStats(processingTimeMs),
          });
          await requestedTrack.setProcessor(processor);
          if (disposedRef.current || requestVersion !== requestVersionRef.current) {
            await requestedTrack.stopProcessor().catch(() => {});
            return;
          }
          processorRef.current = processor;
          processorTrackRef.current = requestedTrack;
          processorSourceKeyRef.current = requestedSourceKey;
          processorModeRef.current = 'none';
        }

        if (requestVersion !== requestVersionRef.current) return;
        if (processorModeRef.current !== requestedMode) {
          await processorRef.current!.switchTo(toBackgroundProcessorOptions(requestedMode));
          processorModeRef.current = requestedMode;
        }
        if (requestVersion === requestVersionRef.current) {
          setProcessorDebugInfo((prev) => ({
            ...prev,
            selectedEngine: 'livekit',
            activeMode: requestedMode,
          }));
        }
      } catch (error) {
        if (requestVersion === requestVersionRef.current) {
          const message = error instanceof Error ? error.message : 'Failed to apply background effect.';
          setProcessorError(message);
          setProcessorDebugInfo((prev) => ({ ...prev, lastError: message }));
        }
      } finally {
        if (requestVersion === requestVersionRef.current) setIsProcessing(false);
      }
    };

    operationRef.current = operationRef.current.catch(() => {}).then(operation);
  }, [
    backgroundProcessingSupported,
    cameraLocalTrack,
    cameraSourceKey,
    localParticipant,
    updateProcessingStats,
    virtualBackground,
  ]);

  useEffect(() => {
    applyProcessor();
  }, [applyProcessor, cameraTrackSid]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      requestVersionRef.current += 1;
      const cleanup = operationRef.current.catch(() => {}).then(async () => {
        if (processorTrackRef.current) {
          await processorTrackRef.current.stopProcessor().catch(() => {});
        }
        processorRef.current = null;
        processorTrackRef.current = null;
        processorSourceKeyRef.current = null;
        processorModeRef.current = null;
      });
      void cleanup;
    };
  }, []);

  return { isProcessing, processorError, backgroundProcessingSupported, processorDebugInfo };
};

// Component that applies background processor (must be inside LiveKitRoom)
interface BackgroundProcessorManagerProps {
  virtualBackground: string;
  onError?: (error: string | null) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  onSupportChange?: (isSupported: boolean) => void;
  onDebugChange?: (debugInfo: BackgroundProcessorDebugInfo) => void;
}

interface AudioProcessingManagerProps {
  audioOptions: AudioCaptureOptions;
  noiseReductionEnabled: boolean;
}

export const BackgroundProcessorManager: React.FC<BackgroundProcessorManagerProps> = ({
  virtualBackground,
  onError,
  onProcessingChange,
  onSupportChange,
  onDebugChange
}) => {
  const { isProcessing, processorError, backgroundProcessingSupported, processorDebugInfo } = useBackgroundProcessor(virtualBackground);

  useEffect(() => {
    onError?.(processorError);
  }, [processorError, onError]);

  useEffect(() => {
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  useEffect(() => {
    onSupportChange?.(backgroundProcessingSupported);
  }, [backgroundProcessingSupported, onSupportChange]);

  useEffect(() => {
    onDebugChange?.(processorDebugInfo);
  }, [processorDebugInfo, onDebugChange]);

  return null; // This component only manages state, renders nothing
};

export const AudioProcessingManager: React.FC<AudioProcessingManagerProps> = ({
  audioOptions,
  noiseReductionEnabled,
}) => {
  const { microphoneTrack } = useLocalParticipant();
  const previousNoiseReductionEnabledRef = useRef(noiseReductionEnabled);

  useEffect(() => {
    if (previousNoiseReductionEnabledRef.current === noiseReductionEnabled) {
      return;
    }
    previousNoiseReductionEnabledRef.current = noiseReductionEnabled;

    const localAudioTrack = microphoneTrack?.track;
    if (!(localAudioTrack instanceof LocalAudioTrack)) {
      return;
    }

    localAudioTrack.restartTrack(audioOptions).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[Meeting] Failed to reapply audio noise settings', err);
    });
  }, [microphoneTrack, audioOptions, noiseReductionEnabled]);

  return null;
};
