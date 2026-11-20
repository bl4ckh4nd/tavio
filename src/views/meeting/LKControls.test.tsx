import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const localParticipantMock = vi.hoisted(() => ({
  setMicrophoneEnabled: vi.fn(async (_enabled: boolean, _options?: unknown) => undefined),
  setCameraEnabled: vi.fn(async (_enabled: boolean) => undefined),
  setScreenShareEnabled: vi.fn(async (_enabled: boolean) => undefined),
}));

const liveKitState = vi.hoisted(() => ({
  isMicrophoneEnabled: true,
  isCameraEnabled: true,
  isScreenShareEnabled: false,
  microphoneTrack: undefined as undefined | { trackSid: string },
  cameraTrack: undefined as undefined | { trackSid: string },
}));

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lingui/core/macro', () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, part, idx) => `${acc}${part}${values[idx] ?? ''}`, ''),
}));

vi.mock('@livekit/components-react', () => ({
  useLocalParticipant: () => ({
    localParticipant: localParticipantMock,
    isMicrophoneEnabled: liveKitState.isMicrophoneEnabled,
    isCameraEnabled: liveKitState.isCameraEnabled,
    isScreenShareEnabled: liveKitState.isScreenShareEnabled,
    microphoneTrack: liveKitState.microphoneTrack,
    cameraTrack: liveKitState.cameraTrack,
  }),
}));

vi.mock('./useCameraSwitch', () => ({
  useCameraSwitch: () => ({ canSwitch: false, isRearCamera: false, switching: false, failed: false, switchCamera: vi.fn() }),
}));

vi.mock('../../components/MeetingControls', () => ({
  ControlBtn: ({
    active,
    pressed,
    onClick,
    label,
    disabled,
  }: {
    active?: boolean;
    pressed?: boolean;
    onClick?: () => void;
    label?: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="control-btn"
      data-active={active ? 'true' : 'false'}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {String(label ?? '')}
    </button>
  ),
}));

import { LKControls } from './LKControls';

describe('LKControls media initialization', () => {
  const baseProps = {
    activeTab: 'none',
    isHandRaised: false,
    isWhiteboardOpen: false,
    isRecording: false,
    canControlRecording: false,
    recordingLoading: false,
    darkMode: false,
    unreadCount: 0,
    onToggleTab: vi.fn(),
    onToggleHandRaise: vi.fn(),
    onToggleWhiteboard: vi.fn(),
    onToggleRecording: vi.fn(),
    onLeave: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  beforeEach(() => {
    localParticipantMock.setMicrophoneEnabled.mockClear();
    localParticipantMock.setCameraEnabled.mockClear();
    localParticipantMock.setScreenShareEnabled.mockClear();
    liveKitState.isMicrophoneEnabled = true;
    liveKitState.isCameraEnabled = true;
    liveKitState.isScreenShareEnabled = false;
    liveKitState.microphoneTrack = undefined;
    liveKitState.cameraTrack = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it('does not force mic/camera changes on mount and reflects live participant state when tracks exist', async () => {
    liveKitState.isMicrophoneEnabled = false;
    liveKitState.isCameraEnabled = true;
    liveKitState.microphoneTrack = { trackSid: 'mic-1' };
    liveKitState.cameraTrack = { trackSid: 'cam-1' };

    render(
      <LKControls
        {...baseProps}
        initialMuted={false}
        initialCameraOff={false}
      />
    );

    await waitFor(() => {
      const buttons = screen.getAllByTestId('control-btn');
      expect(buttons[0]).toHaveAttribute('data-active', 'false');
      expect(buttons[1]).toHaveAttribute('data-active', 'true');
    });

    expect(localParticipantMock.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(localParticipantMock.setCameraEnabled).not.toHaveBeenCalled();
  });

  it('respects initial muted/camera intent before tracks are available', async () => {
    liveKitState.isMicrophoneEnabled = true;
    liveKitState.isCameraEnabled = true;
    liveKitState.microphoneTrack = undefined;
    liveKitState.cameraTrack = undefined;

    render(
      <LKControls
        {...baseProps}
        initialMuted
        initialCameraOff
      />
    );

    await waitFor(() => {
      const buttons = screen.getAllByTestId('control-btn');
      expect(buttons[0]).toHaveAttribute('data-active', 'false');
      expect(buttons[1]).toHaveAttribute('data-active', 'false');
      expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('toggles microphone through local participant API', async () => {
    liveKitState.isMicrophoneEnabled = true;

    render(
      <LKControls
        {...baseProps}
        initialMuted={false}
        initialCameraOff={false}
      />
    );

    const buttons = screen.getAllByTestId('control-btn');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(localParticipantMock.setMicrophoneEnabled).toHaveBeenCalledWith(false, undefined);
    });
  });

  it('passes capture options when enabling microphone', async () => {
    liveKitState.isMicrophoneEnabled = false;
    liveKitState.microphoneTrack = undefined;
    const audioCaptureOptions = {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: false,
    };

    render(
      <LKControls
        {...baseProps}
        initialMuted
        initialCameraOff={false}
        audioCaptureOptions={audioCaptureOptions as any}
      />
    );

    const buttons = screen.getAllByTestId('control-btn');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(localParticipantMock.setMicrophoneEnabled).toHaveBeenCalledWith(true, audioCaptureOptions);
    });
  });

  const openMore = () => {
    const more = screen.getAllByTestId('control-btn').find((button) => button.textContent === 'More');
    fireEvent.click(more!);
  };

  it('opens the transcript panel from More and closes the menu', () => {
    const onToggleTab = vi.fn();
    render(<LKControls {...baseProps} onToggleTab={onToggleTab} />);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Transcript' }));

    expect(onToggleTab).toHaveBeenCalledWith('transcript');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('returns focus to More when a menu item opens something', () => {
    render(<LKControls {...baseProps} />);
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));

    const more = screen.getAllByTestId('control-btn').find((button) => button.textContent === 'More');
    expect(more).toHaveFocus();
  });

  it('keeps recording in More for hosts only', () => {
    const onToggleRecording = vi.fn();
    const { rerender } = render(<LKControls {...baseProps} onToggleRecording={onToggleRecording} />);
    openMore();
    expect(screen.queryByRole('menuitem', { name: 'Start Recording' })).not.toBeInTheDocument();

    rerender(<LKControls {...baseProps} canControlRecording onToggleRecording={onToggleRecording} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start Recording' }));
    expect(onToggleRecording).toHaveBeenCalledOnce();

    rerender(<LKControls {...baseProps} canControlRecording isRecording onToggleRecording={onToggleRecording} />);
    openMore();
    expect(screen.getByRole('menuitem', { name: 'Stop Recording' })).toBeInTheDocument();
  });

  it('reaches every tool the toolbar folds away from More', () => {
    const onToggleTab = vi.fn();
    const onToggleHandRaise = vi.fn();
    const onToggleWhiteboard = vi.fn();
    const onOpenSettings = vi.fn();
    const onOpenHandoff = vi.fn();
    render(
      <LKControls
        {...baseProps}
        onToggleTab={onToggleTab}
        onToggleHandRaise={onToggleHandRaise}
        onToggleWhiteboard={onToggleWhiteboard}
        onOpenSettings={onOpenSettings}
        onOpenHandoff={onOpenHandoff}
      />
    );

    const pick = (name: string) => {
      openMore();
      fireEvent.click(screen.getByRole('menuitem', { name }));
    };
    pick('Participants');
    expect(onToggleTab).toHaveBeenLastCalledWith('people');
    pick('Breakout Rooms');
    expect(onToggleTab).toHaveBeenLastCalledWith('breakout');
    pick('Effects');
    expect(onToggleTab).toHaveBeenLastCalledWith('effects');
    pick('Raise Hand');
    expect(onToggleHandRaise).toHaveBeenCalledOnce();
    pick('Whiteboard');
    expect(onToggleWhiteboard).toHaveBeenCalledOnce();
    pick('Settings');
    expect(onOpenSettings).toHaveBeenCalledOnce();
    pick('Switch to another device');
    expect(onOpenHandoff).toHaveBeenCalledOnce();
    pick('Share');
    expect(localParticipantMock.setScreenShareEnabled).toHaveBeenCalledWith(true);
  });

  it('closes More with Escape without closing the panel behind it', () => {
    const onKeyDown = vi.fn();
    render(<div onKeyDown={onKeyDown}><LKControls {...baseProps} /></div>);
    openMore();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('locks the microphone control until the provider call settles', async () => {
    let settle: (() => void) | undefined;
    localParticipantMock.setMicrophoneEnabled.mockImplementation(
      () => new Promise<undefined>((resolve) => { settle = () => resolve(undefined); })
    );

    render(
      <LKControls
        {...baseProps}
        initialMuted={false}
        initialCameraOff={false}
      />
    );

    const mic = screen.getAllByTestId('control-btn')[0];
    fireEvent.click(mic);

    await waitFor(() => expect(mic).toBeDisabled());

    // A second tap while in flight must not reach the provider.
    fireEvent.click(mic);
    expect(localParticipantMock.setMicrophoneEnabled).toHaveBeenCalledTimes(1);

    await act(async () => { settle?.(); });

    await waitFor(() => expect(mic).not.toBeDisabled());
    expect(mic).toHaveAttribute('data-active', 'false');
  });

  it('restores LiveKit truth and reports when a toggle rejects', async () => {
    liveKitState.isMicrophoneEnabled = true;
    liveKitState.microphoneTrack = { trackSid: 'mic-1' };
    localParticipantMock.setMicrophoneEnabled.mockRejectedValueOnce(new Error('device busy'));

    render(
      <LKControls
        {...baseProps}
        initialMuted={false}
        initialCameraOff={false}
      />
    );

    const mic = screen.getAllByTestId('control-btn')[0];
    expect(mic).toHaveAttribute('data-active', 'true');

    fireEvent.click(mic);

    // Optimistic: the tap is acknowledged before the provider settles.
    await waitFor(() => expect(mic).toHaveAttribute('data-active', 'false'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('device busy'));
    // LiveKit still reports the microphone as enabled, so provider truth wins.
    await waitFor(() => expect(mic).toHaveAttribute('data-active', 'true'));
    expect(mic).not.toBeDisabled();
  });
});
