import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backgroundProcessorMock = vi.hoisted(() => vi.fn());
const mediaMock = vi.hoisted(() => {
  const videoTrack = { kind: 'video', stop: vi.fn() };
  const stream = {
    getTracks: () => [videoTrack],
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [],
  };
  return { stream, videoTrack };
});

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@lingui/react', () => ({ useLingui: () => ({ i18n: { _: ({ message }: { message: string }) => message } }) }));
vi.mock('@livekit/track-processors', () => ({
  BackgroundProcessor: backgroundProcessorMock,
  supportsBackgroundProcessors: () => true,
}));
vi.mock('livekit-client', () => ({
  LocalVideoTrack: class {
    mediaStreamTrack: MediaStreamTrack;
    constructor(track: MediaStreamTrack) {
      this.mediaStreamTrack = track;
    }
    attach = vi.fn();
    detach = vi.fn();
    getSourceTrackSettings = () => ({ deviceId: 'camera-1', width: 1280, height: 720 });
    stopProcessor = vi.fn(async () => undefined);
    setProcessor = vi.fn(async () => undefined);
  },
}));
vi.mock('../components/ui', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  Input: () => null,
  Avatar: () => null,
  Modal: () => null,
  Select: ({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) => (
    <label>
      {label}
      <select {...props}>{children}</select>
    </label>
  ),
}));
vi.mock('../components/BrandMark', () => ({ BrandMark: () => null }));
vi.mock('./meeting/audioCapture', () => ({
  buildAudioCaptureOptions: () => ({}),
  getNoiseReductionSupport: () => ({ supported: false }),
  readNoiseReductionPreference: () => false,
  writeNoiseReductionPreference: vi.fn(),
}));

import { Lobby } from './Lobby';
import { RoomAccess, RoomType, type Room } from '../types';

const ROOM: Room = {
  id: 'room-1',
  slug: 'room',
  name: 'Room',
  type: RoomType.WORKSPACE,
  access: RoomAccess.OPEN,
  activeParticipants: 0,
  maxParticipants: 10,
  locked: false,
  recording: false,
  createdAt: '2026-10-30',
};

describe('Lobby background processor ownership', () => {
  beforeEach(() => {
    backgroundProcessorMock.mockReset();
    mediaMock.videoTrack.stop.mockClear();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => mediaMock.stream),
        enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'camera-1', label: 'Camera' }]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(cleanup);

  it('does not create a processor for the default none background', async () => {
    render(
      <Lobby
        roomSlug="room"
        roomLoading
        onNavigate={vi.fn()}
        onJoin={vi.fn()}
      />,
    );

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2));
    expect(backgroundProcessorMock).not.toHaveBeenCalled();
  });
});

describe('Lobby join sheet', () => {
  const useMedia = (overrides: Partial<MediaDevices> = {}) => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => mediaMock.stream),
        enumerateDevices: vi.fn(async () => [
          { kind: 'audioinput', deviceId: 'mic-1', label: 'USB Mic' },
          { kind: 'audioinput', deviceId: 'mic-2', label: 'Headset' },
          { kind: 'videoinput', deviceId: 'camera-1', label: 'HD Webcam' },
          { kind: 'videoinput', deviceId: 'camera-2', label: 'Document Camera' },
        ]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        ...overrides,
      },
    });
  };

  afterEach(cleanup);

  it('selects devices directly and carries the choice into the stream and the join payload', async () => {
    useMedia();
    const onJoin = vi.fn();
    render(<Lobby roomSlug="room" initialName="Priya" room={ROOM} onNavigate={vi.fn()} onJoin={onJoin} />);

    const camera = screen.getByRole('combobox', { name: 'Camera' });
    await waitFor(() => expect(camera).toBeEnabled());
    expect(screen.getByRole('option', { name: 'USB Mic' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Document Camera' })).toBeInTheDocument();

    fireEvent.change(camera, { target: { value: 'camera-2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Microphone' }), { target: { value: 'mic-2' } });

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ deviceId: { exact: 'camera-2' } }) }),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Join Meeting' }));
    expect(onJoin).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Priya',
      audioInputDeviceId: 'mic-2',
      videoInputDeviceId: 'camera-2',
    }));
  });

  it('keeps the selects disabled on a default label without device access', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    useMedia({
      getUserMedia: vi.fn(async () => {
        throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      }),
    });
    render(<Lobby roomSlug="room" initialName="Priya" room={ROOM} onNavigate={vi.fn()} onJoin={vi.fn()} />);

    await screen.findByText('Access Denied');
    expect(screen.getByRole('combobox', { name: 'Microphone' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Camera' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Default Microphone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join Meeting' })).toBeDisabled();
    consoleError.mockRestore();
  });

  it('spends a room colour on the join action only and picks readable type for it', async () => {
    useMedia();
    const { container, rerender } = render(
      <Lobby roomSlug="room" initialName="Priya" room={{ ...ROOM, branding: { primaryColor: '#0f6e6e', theme: 'dark' } }} onNavigate={vi.fn()} onJoin={vi.fn()} />,
    );

    const join = () => screen.getByRole('button', { name: 'Join Meeting' });
    expect(join()).toHaveClass('btn--room');
    expect(join().style.getPropertyValue('--room-primary')).toBe('#0f6e6e');
    expect(join().style.getPropertyValue('--room-primary-type')).toBe('var(--color-board-type)');
    expect(container.querySelector('main')).toHaveClass('dark');

    rerender(<Lobby roomSlug="room" initialName="Priya" room={{ ...ROOM, branding: { primaryColor: '#f5b301' } }} onNavigate={vi.fn()} onJoin={vi.fn()} />);
    expect(join().style.getPropertyValue('--room-primary-type')).toBe('var(--color-board)');
    expect(container.querySelector('main')).not.toHaveClass('dark');

    // The emerald the room form used to prefill was never a choice, so the action stays ink.
    rerender(<Lobby roomSlug="room" initialName="Priya" room={{ ...ROOM, branding: { primaryColor: '#10b981' } }} onNavigate={vi.fn()} onJoin={vi.fn()} />);
    expect(join()).toHaveClass('btn--ink');
    expect(join().style.getPropertyValue('--room-primary')).toBe('');
  });
});
