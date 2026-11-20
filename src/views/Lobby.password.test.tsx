import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mediaMock = vi.hoisted(() => {
  const videoTrack = { kind: 'video', stop: vi.fn() };
  return {
    getTracks: () => [videoTrack],
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [],
  };
});

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@lingui/react', () => ({ useLingui: () => ({ i18n: { _: ({ message }: { message: string }) => message } }) }));
vi.mock('@livekit/track-processors', () => ({
  BackgroundProcessor: vi.fn(),
  supportsBackgroundProcessors: () => false,
}));
vi.mock('livekit-client', () => ({
  LocalVideoTrack: class {
    attach = vi.fn();
    detach = vi.fn();
    getSourceTrackSettings = () => ({ deviceId: 'camera-1' });
    stopProcessor = vi.fn(async () => undefined);
    setProcessor = vi.fn(async () => undefined);
  },
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
  access: RoomAccess.PASSWORD,
  activeParticipants: 0,
  maxParticipants: 10,
  locked: false,
  recording: false,
  createdAt: '2026-10-30',
};

const openPasswordDialog = async (onPasswordSubmit: (user: unknown, password: string) => Promise<boolean | undefined>) => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => mediaMock),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  render(
    <Lobby roomSlug="room" initialName="Priya" room={ROOM} requirePassword onNavigate={vi.fn()} onJoin={vi.fn()} onPasswordSubmit={onPasswordSubmit} />,
  );
  const join = screen.getByRole('button', { name: 'Join with password' });
  await waitFor(() => expect(join).toBeEnabled());
  fireEvent.click(join);
  return screen.findByLabelText('Password');
};

describe('Lobby room password', () => {
  afterEach(cleanup);

  it('joins when Enter is pressed in the password field', async () => {
    const onPasswordSubmit = vi.fn(async () => true);
    const input = await openPasswordDialog(onPasswordSubmit);

    await userEvent.type(input, 'open sesame{Enter}');

    await waitFor(() => expect(onPasswordSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Priya' }), 'open sesame'));
  });

  it('asks for a password on Enter instead of submitting an empty one', async () => {
    const onPasswordSubmit = vi.fn(async () => true);
    const input = await openPasswordDialog(onPasswordSubmit);

    await userEvent.type(input, '{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Password required');
    expect(onPasswordSubmit).not.toHaveBeenCalled();
  });
});
