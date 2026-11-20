import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {} as MediaTrackSettings,
  devices: [] as { deviceId: string; label: string }[],
  activeDeviceId: 'a',
  isCameraEnabled: true,
  restartTrack: vi.fn(async () => {}),
  setActiveMediaDevice: vi.fn(async () => {}),
}));

vi.mock('@livekit/components-react', () => ({
  useLocalParticipant: () => ({
    isCameraEnabled: state.isCameraEnabled,
    cameraTrack: {
      videoTrack: {
        mediaStreamTrack: { getSettings: () => state.settings, label: '' },
        restartTrack: state.restartTrack,
        on: vi.fn(),
        off: vi.fn(),
      },
    },
  }),
  useMediaDeviceSelect: () => ({
    devices: state.devices,
    activeDeviceId: state.activeDeviceId,
    setActiveMediaDevice: state.setActiveMediaDevice,
  }),
}));

import { useCameraSwitch } from './useCameraSwitch';

const twoCameras = [{ deviceId: 'a', label: 'One' }, { deviceId: 'b', label: 'Two' }];

describe('useCameraSwitch', () => {
  beforeEach(() => {
    state.settings = {};
    state.devices = twoCameras;
    state.activeDeviceId = 'a';
    state.isCameraEnabled = true;
    state.restartTrack.mockClear();
    state.setActiveMediaDevice.mockClear();
  });

  it('offers nothing with one camera or with the camera off', () => {
    state.devices = [twoCameras[0]];
    expect(renderHook(() => useCameraSwitch()).result.current.canSwitch).toBe(false);

    state.devices = twoCameras;
    state.isCameraEnabled = false;
    expect(renderHook(() => useCameraSwitch()).result.current.canSwitch).toBe(false);
  });

  it('turns a phone around by facing, because a phone lists many lenses', async () => {
    state.settings = { facingMode: 'user' };
    const { result } = renderHook(() => useCameraSwitch());
    expect(result.current.isRearCamera).toBe(false);

    await act(() => result.current.switchCamera());

    expect(state.restartTrack).toHaveBeenCalledWith(expect.objectContaining({ facingMode: 'environment' }));
    expect(state.setActiveMediaDevice).not.toHaveBeenCalled();
  });

  it('turns back to the front from the rear camera, which is not mirrored', async () => {
    state.settings = { facingMode: 'environment' };
    const { result } = renderHook(() => useCameraSwitch());
    expect(result.current.isRearCamera).toBe(true);

    await act(() => result.current.switchCamera());

    expect(state.restartTrack).toHaveBeenCalledWith(expect.objectContaining({ facingMode: 'user' }));
  });

  it('steps to the next device when the camera does not report a facing', async () => {
    state.activeDeviceId = 'b';
    const { result } = renderHook(() => useCameraSwitch());

    await act(() => result.current.switchCamera());

    expect(state.setActiveMediaDevice).toHaveBeenCalledWith('a');
    expect(state.restartTrack).not.toHaveBeenCalled();
  });

  it('reports a camera that could not be switched', async () => {
    state.settings = { facingMode: 'user' };
    state.restartTrack.mockRejectedValueOnce(new Error('busy'));
    const { result } = renderHook(() => useCameraSwitch());

    await act(() => result.current.switchCamera());

    expect(result.current.failed).toBe(true);
  });
});
