import React, { useContext, useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  LogOut,
  MessageSquare,
  Users,
  DoorOpen,
  Hand,
  FileText,
  WandSparkles,
  CircleDot,
  Settings,
  SwitchCamera,
  Ellipsis,
  PenTool,
  Captions,
  Smartphone,
} from 'lucide-react';
import { useLocalParticipant } from '@livekit/components-react';
import type { AudioCaptureOptions, LocalParticipant } from 'livekit-client';
import { ControlBtn } from '../../components/MeetingControls';

import { useCameraSwitch } from './useCameraSwitch';
import { MeetingRoomContext } from './MeetingRoomContext';
import { AssistantMenuItem } from './assistant/AssistantOverlay';

export interface LKControlsProps {
  activeTab: string;
  isHandRaised: boolean;
  isWhiteboardOpen: boolean;
  isRecording: boolean;
  canControlRecording: boolean;
  recordingLoading: boolean;
  recordingStarting?: boolean;
  darkMode: boolean;
  initialMuted?: boolean;
  initialCameraOff?: boolean;
  audioCaptureOptions?: AudioCaptureOptions;
  unreadCount: number;
  onToggleTab: (tab: 'chat' | 'people' | 'notes' | 'effects' | 'breakout' | 'transcript') => void;
  onToggleHandRaise: () => void;
  onToggleWhiteboard: () => void;
  onToggleRecording: () => void;
  onLeave: () => void;
  onOpenSettings: () => void;
  onOpenHandoff?: () => void;
}

export const LKControls: React.FC<LKControlsProps> = ({
  activeTab,
  isHandRaised,
  isWhiteboardOpen,
  isRecording,
  canControlRecording,
  recordingLoading,
  recordingStarting = false,
  initialMuted,
  initialCameraOff,
  audioCaptureOptions,
  unreadCount,
  onToggleTab,
  onToggleHandRaise,
  onToggleWhiteboard,
  onToggleRecording,
  onLeave,
  onOpenSettings,
  onOpenHandoff,
}) => {
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
    microphoneTrack,
    cameraTrack,
  } = useLocalParticipant();
  const [micEnabled, setMicEnabled] = useState(typeof initialMuted === 'boolean' ? !initialMuted : true);
  const [camEnabled, setCamEnabled] = useState(typeof initialCameraOff === 'boolean' ? !initialCameraOff : true);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<'mic' | 'cam' | 'screen' | null>(null);
  const camera = useCameraSwitch();
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const mediaErrorTimer = useRef<number | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!microphoneTrack && typeof initialMuted === 'boolean') {
      setMicEnabled(!initialMuted);
      return;
    }
    setMicEnabled(isMicrophoneEnabled);
  }, [isMicrophoneEnabled, microphoneTrack, initialMuted]);

  useEffect(() => {
    if (!cameraTrack && typeof initialCameraOff === 'boolean') {
      setCamEnabled(!initialCameraOff);
      return;
    }
    setCamEnabled(isCameraEnabled);
  }, [isCameraEnabled, cameraTrack, initialCameraOff]);

  useEffect(() => {
    setScreenEnabled(isScreenShareEnabled);
  }, [isScreenShareEnabled]);

  useEffect(() => () => {
    if (mediaErrorTimer.current !== null) window.clearTimeout(mediaErrorTimer.current);
  }, []);

  const reportMediaError = (message: string) => {
    setMediaError(message);
    if (mediaErrorTimer.current !== null) window.clearTimeout(mediaErrorTimer.current);
    mediaErrorTimer.current = window.setTimeout(() => setMediaError(null), 5000);
  };

  useEffect(() => {
    if (camera.failed) reportMediaError(t`The camera could not be switched. Try again, or pick one in Settings.`);
  }, [camera.failed]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Media toggles are optimistic: local state flips immediately so the button
   * acknowledges the tap, the control locks until the provider call settles, and
   * a rejection falls back to the LiveKit-reported track state.
   */
  const runMediaToggle = async (
    control: 'mic' | 'cam' | 'screen',
    next: boolean,
    apply: (participant: LocalParticipant) => Promise<unknown>,
    revert: () => void,
  ) => {
    if (pendingToggle !== null) return;
    setMediaError(null);
    setPendingToggle(control);
    if (control === 'mic') setMicEnabled(next);
    else if (control === 'cam') setCamEnabled(next);
    else setScreenEnabled(next);

    try {
      const participant = localParticipant;
      if (!participant) throw new Error(t`Not connected to the room yet.`);
      await apply(participant);
    } catch (error) {
      revert();
      reportMediaError(
        error instanceof Error && error.message
          ? error.message
          : {
              mic: next ? t`Could not turn the microphone on.` : t`Could not turn the microphone off.`,
              cam: next ? t`Could not turn the camera on.` : t`Could not turn the camera off.`,
              screen: next ? t`Could not start screen sharing.` : t`Could not stop screen sharing.`,
            }[control]
      );
    } finally {
      setPendingToggle(null);
    }
  };

  const toggleMic = () => void runMediaToggle(
    'mic',
    !micEnabled,
    participant => participant.setMicrophoneEnabled(!micEnabled, !micEnabled ? audioCaptureOptions : undefined),
    () => setMicEnabled(isMicrophoneEnabled),
  );

  const toggleCam = () => void runMediaToggle(
    'cam',
    !camEnabled,
    participant => participant.setCameraEnabled(!camEnabled),
    () => setCamEnabled(isCameraEnabled),
  );

  const toggleScreen = () => void runMediaToggle(
    'screen',
    !screenEnabled,
    participant => participant.setScreenShareEnabled(!screenEnabled),
    () => setScreenEnabled(isScreenShareEnabled),
  );

  const visibleMenuItems = () =>
    [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
      .filter((item) => item.getClientRects().length > 0);

  useEffect(() => {
    if (moreOpen) visibleMenuItems()[0]?.focus();
  }, [moreOpen]);

  // The assistant needs the room's backend; a simulated room has none.
  const hasRoom = !!useContext(MeetingRoomContext);

  const closeMore = () => {
    setMoreOpen(false);
    moreRef.current?.querySelector('button')?.focus();
  };

  // Focus goes back first, so a dialog opened by the action returns it to More when it closes.
  const runFromMenu = (action: () => void) => () => {
    closeMore();
    action();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMore();
      return;
    }
    if (event.key === 'Tab') {
      setMoreOpen(false);
      return;
    }
    const items = visibleMenuItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const target =
      event.key === 'ArrowDown' ? items[(current + 1) % items.length]
      : event.key === 'ArrowUp' ? items[(current - 1 + items.length) % items.length]
      : event.key === 'Home' ? items[0]
      : event.key === 'End' ? items[items.length - 1]
      : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  // On a phone these four move from the toolbar into More, so More reports them as open.
  const phoneToolOpen = activeTab === 'people' || isWhiteboardOpen || screenEnabled || isHandRaised;
  const moreToolOpen = activeTab === 'transcript' || activeTab === 'breakout' || activeTab === 'effects';

  return (
    <div data-testid="meeting-control-bar" className="ctlbar mbar" role="toolbar" aria-label={t`Meeting Controls`}>
      {mediaError && (
        <p role="alert" className="notice notice--error stock mbar__error">{mediaError}</p>
      )}
      <ControlBtn
        kind="media"
        icon={micEnabled ? <Mic className="icon" /> : <MicOff className="icon" />}
        active={micEnabled}
        pressed={!micEnabled}
        onClick={toggleMic}
        label={micEnabled ? t`Mute microphone` : t`Unmute microphone`}
        caption={t`Microphone`}
        disabled={pendingToggle !== null}
      />
      <ControlBtn
        kind="media"
        icon={camEnabled ? <Video className="icon" /> : <VideoOff className="icon" />}
        active={camEnabled}
        pressed={!camEnabled}
        onClick={toggleCam}
        label={camEnabled ? t`Turn camera off` : t`Turn camera on`}
        caption={t`Camera`}
        disabled={pendingToggle !== null}
      />

      <span className="ctlbar__sep mbar__wide" aria-hidden="true" />

      <ControlBtn
        icon={<MonitorUp className="icon" />}
        active={screenEnabled}
        onClick={toggleScreen}
        label={screenEnabled ? t`Stop Sharing` : t`Share Screen`}
        caption={t`Share`}
        disabled={pendingToggle !== null}
        className="mbar__wide"
      />
      <ControlBtn
        icon={<Hand className="icon" />}
        active={isHandRaised}
        onClick={onToggleHandRaise}
        label={t`Raise Hand`}
        className="mbar__wide"
      />

      <span className="ctlbar__sep mbar__wide" aria-hidden="true" />

      <ControlBtn
        icon={<MessageSquare className="icon" />}
        active={activeTab === 'chat'}
        badge={unreadCount > 0 && activeTab !== 'chat' ? unreadCount : undefined}
        onClick={() => onToggleTab('chat')}
        label={t`Chat`}
      />
      <ControlBtn
        icon={<Users className="icon" />}
        active={activeTab === 'people'}
        onClick={() => onToggleTab('people')}
        label={t`Participants`}
        className="mbar__wide"
      />
      <ControlBtn
        icon={<FileText className="icon" />}
        active={activeTab === 'notes'}
        onClick={() => onToggleTab('notes')}
        label={t`Notes`}
      />
      <ControlBtn
        icon={<PenTool className="icon" />}
        active={isWhiteboardOpen}
        onClick={onToggleWhiteboard}
        label={t`Whiteboard`}
        className="mbar__wide"
      />

      <div ref={moreRef} className="mmore-anchor">
        <ControlBtn
          icon={<Ellipsis className="icon" />}
          active={moreOpen || moreToolOpen}
          expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          label={t`More`}
          className={phoneToolOpen ? 'mbar__more--phone-open' : ''}
        />
        {moreOpen && (
          <>
            <div className="mmore__scrim" aria-hidden="true" onClick={() => setMoreOpen(false)} />
            <div
              ref={menuRef}
              className="menu stock stock--lift mmore"
              role="menu"
              aria-label={t`More`}
              onKeyDown={handleMenuKeyDown}
            >
              <button type="button" role="menuitem" className="menu__item mmore__phone" onClick={runFromMenu(() => onToggleTab('people'))}>
                <Users className="icon" /><span>{t`Participants`}</span>
              </button>
              <button type="button" role="menuitem" className="menu__item mmore__phone" disabled={pendingToggle !== null} onClick={runFromMenu(toggleScreen)}>
                <MonitorUp className="icon" /><span>{screenEnabled ? t`Stop Sharing` : t`Share`}</span>
              </button>
              <button type="button" role="menuitem" className="menu__item mmore__phone" onClick={runFromMenu(onToggleHandRaise)}>
                <Hand className="icon" /><span>{isHandRaised ? t`Lower Hand` : t`Raise Hand`}</span>
              </button>
              <button type="button" role="menuitem" className="menu__item mmore__phone" onClick={runFromMenu(onToggleWhiteboard)}>
                <PenTool className="icon" /><span>{t`Whiteboard`}</span>
              </button>
              <div className="bsheet__rule mmore__phone" role="separator" />
              {hasRoom && <AssistantMenuItem onDone={closeMore} />}
              {canControlRecording && (
                <button type="button" role="menuitem" className="menu__item" disabled={recordingLoading || recordingStarting} aria-busy={recordingLoading || recordingStarting} onClick={runFromMenu(onToggleRecording)}>
                  <CircleDot className="icon" /><span>{recordingStarting ? t`Recording is starting…` : isRecording ? t`Stop Recording` : t`Start Recording`}</span>
                </button>
              )}
              <button type="button" role="menuitem" className="menu__item" onClick={runFromMenu(() => onToggleTab('transcript'))}>
                <Captions className="icon" /><span>{t`Transcript`}</span>
              </button>
              <button type="button" role="menuitem" className="menu__item" onClick={runFromMenu(() => onToggleTab('breakout'))}>
                <DoorOpen className="icon" /><span>{t`Breakout Rooms`}</span>
              </button>
              <button type="button" role="menuitem" className="menu__item" onClick={runFromMenu(() => onToggleTab('effects'))}>
                <WandSparkles className="icon" /><span>{t`Effects`}</span>
              </button>
              {onOpenHandoff && (
                <button type="button" role="menuitem" className="menu__item" onClick={runFromMenu(onOpenHandoff)}>
                  <Smartphone className="icon" /><span>{t`Switch to another device`}</span>
                </button>
              )}
              {camera.canSwitch && (
                <button type="button" role="menuitem" className="menu__item" disabled={camera.switching} onClick={runFromMenu(() => void camera.switchCamera())}>
                  <SwitchCamera className="icon" /><span>{t`Switch camera`}</span>
                </button>
              )}
              <button type="button" role="menuitem" className="menu__item" onClick={runFromMenu(onOpenSettings)}>
                <Settings className="icon" /><span>{t`Settings`}</span>
              </button>
            </div>
          </>
        )}
      </div>

      <ControlBtn
        kind="leave"
        icon={<LogOut className="icon" />}
        onClick={onLeave}
        label={t`Leave`}
      />
    </div>
  );
};
