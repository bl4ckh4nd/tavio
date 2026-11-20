import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { ArrowRightLeft, X } from 'lucide-react';
import { useLocalParticipant, useMediaDeviceSelect } from '@livekit/components-react';
import { supportsAudioOutputSelection } from 'livekit-client';
import { Button, IconButton, Modal, Notice, Select, Switch } from '../../components/ui';

const METER_BARS = [5, 8, 11, 14, 16];

// Mic level meter using the active microphone track
const MicLevelMeter: React.FC = () => {
  const { microphoneTrack } = useLocalParticipant();
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const track = microphoneTrack?.track?.mediaStreamTrack;
    if (!track) return;
    const ctx = new AudioContext();
    const stream = new MediaStream([track]);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
    sourceRef.current = source;
    ctxRef.current = ctx;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      setLevel(Math.min(100, (avg / 128) * 100 * 2));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      source.disconnect();
      ctx.close();
    };
  }, [microphoneTrack]);

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="muted"><Trans>Mic Level</Trans></span>
        <div className="meter" aria-hidden="true">
          {METER_BARS.map((height, index) => (
            <i key={height} className={level > index * 20 ? 'on' : ''} style={{ height }} />
          ))}
        </div>
      </div>
      {level === 0 && (
        <p className="field__help">
          {microphoneTrack ? <Trans>No audio detected</Trans> : <Trans>Microphone not active</Trans>}
        </p>
      )}
    </div>
  );
};

export interface SettingsModalProps {
  show: boolean;
  darkMode: boolean;
  toggleDarkMode: () => void;
  noiseReductionEnabled: boolean;
  noiseReductionSupported?: boolean;
  onNoiseReductionChange: (enabled: boolean) => void;
  onOpenHandoff?: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  show,
  darkMode,
  toggleDarkMode,
  noiseReductionEnabled,
  noiseReductionSupported = true,
  onNoiseReductionChange,
  onOpenHandoff,
  onClose,
}) => {
  const {
    devices: cameraDevices,
    activeDeviceId: activeCameraId,
    setActiveMediaDevice: setActiveCamera,
  } = useMediaDeviceSelect({ kind: 'videoinput' });
  const {
    devices: micDevices,
    activeDeviceId: activeMicId,
    setActiveMediaDevice: setActiveMic,
  } = useMediaDeviceSelect({ kind: 'audioinput' });
  const {
    devices: speakerDevices,
    activeDeviceId: activeSpeakerId,
    setActiveMediaDevice: setActiveSpeaker,
  } = useMediaDeviceSelect({ kind: 'audiooutput' });
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const speakerSelectionSupported = supportsAudioOutputSelection();

  const changeDevice = useCallback(async (setter: (deviceId: string) => Promise<unknown> | unknown, deviceId: string) => {
    try {
      await setter(deviceId);
      setDeviceError(null);
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Unable to change device.');
    }
  }, []);

  if (!show) return null;

  return (
    <Modal isOpen={show} onClose={onClose} ariaLabel={t`Settings`} className="msettings dialog max-w-[420px]! max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <h3 className="dialog__title"><Trans>Settings</Trans></h3>
          <IconButton label={t`Close settings`} onClick={onClose} className="-mr-2">
            <X className="icon" aria-hidden="true" />
          </IconButton>
        </div>
        {deviceError && <Notice variant="error">{deviceError}</Notice>}
        <Select
          label={t`Microphone`}
          value={activeMicId ?? 'default'}
          onChange={e => void changeDevice(setActiveMic, e.target.value)}
        >
          <option value="default"><Trans>System Default</Trans></option>
          {micDevices.map(dev => (
            <option key={dev.deviceId} value={dev.deviceId}>{dev.label || t`Microphone`}</option>
          ))}
        </Select>
        <MicLevelMeter />
        <Select
          label={t`Camera`}
          value={activeCameraId ?? 'default'}
          onChange={e => void changeDevice(setActiveCamera, e.target.value)}
        >
          <option value="default"><Trans>System Default</Trans></option>
          {cameraDevices.map(dev => (
            <option key={dev.deviceId} value={dev.deviceId}>{dev.label || t`Camera`}</option>
          ))}
        </Select>
        {speakerSelectionSupported && <Select
          label={t`Speaker`}
          value={activeSpeakerId ?? 'default'}
          onChange={e => void changeDevice(setActiveSpeaker, e.target.value)}
        >
          <option value="default"><Trans>System Default</Trans></option>
          {speakerDevices.map(dev => (
            <option key={dev.deviceId} value={dev.deviceId}>{dev.label || t`Speaker`}</option>
          ))}
        </Select>}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="field__label"><Trans>Noise Reduction</Trans></p>
            <p className="field__help">
              <Trans>Filters background noise for clearer microphone audio.</Trans>
            </p>
            {!noiseReductionSupported && (
              <p className="field__help">
                <Trans>Your browser does not expose noise suppression controls.</Trans>
              </p>
            )}
          </div>
          <Switch
            checked={noiseReductionEnabled}
            onChange={onNoiseReductionChange}
            disabled={!noiseReductionSupported}
            label={t`Toggle noise reduction`}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="field__label"><Trans>Dark Mode</Trans></span>
          <Switch checked={darkMode} onChange={() => toggleDarkMode()} label={t`Toggle dark mode`} />
        </div>
        {onOpenHandoff && <Button type="button" variant="secondary" className="btn--wide" onClick={onOpenHandoff}>
          <ArrowRightLeft className="icon" aria-hidden="true" />
          <Trans>Switch to another device</Trans>
        </Button>}
        <div className="dialog__actions">
          <Button type="button" onClick={onClose}><Trans>Done</Trans></Button>
        </div>
    </Modal>
  );
};

export interface InitialDeviceSetupProps {
  audioInputDeviceId?: string;
  videoInputDeviceId?: string;
  audioOutputDeviceId?: string;
}


// Applies the lobby's choice until it took hold. After that a change in the call must stay.
const useLobbyDevice = (
  deviceId: string | undefined,
  activeDeviceId: string | undefined,
  setActiveDevice: (deviceId: string) => unknown,
) => {
  const settled = useRef(false);
  useEffect(() => {
    if (!deviceId || settled.current) return;
    if (deviceId === activeDeviceId) settled.current = true;
    else setActiveDevice(deviceId);
  }, [deviceId, activeDeviceId, setActiveDevice]);
};

export const InitialDeviceSetup: React.FC<InitialDeviceSetupProps> = ({
  audioInputDeviceId,
  videoInputDeviceId,
  audioOutputDeviceId,
}) => {
  const {
    activeDeviceId: activeMicId,
    setActiveMediaDevice: setActiveMic,
  } = useMediaDeviceSelect({ kind: 'audioinput' });
  const {
    activeDeviceId: activeCameraId,
    setActiveMediaDevice: setActiveCamera,
  } = useMediaDeviceSelect({ kind: 'videoinput' });
  const {
    activeDeviceId: activeSpeakerId,
    setActiveMediaDevice: setActiveSpeaker,
  } = useMediaDeviceSelect({ kind: 'audiooutput' });

  useLobbyDevice(audioInputDeviceId, activeMicId, setActiveMic);
  useLobbyDevice(videoInputDeviceId, activeCameraId, setActiveCamera);
  useLobbyDevice(audioOutputDeviceId, activeSpeakerId, setActiveSpeaker);

  return null;
};
