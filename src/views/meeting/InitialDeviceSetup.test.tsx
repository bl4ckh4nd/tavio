import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const devices = vi.hoisted(() => ({
  activeCamera: 'default',
  setActiveCamera: vi.fn(),
}));

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@lingui/core/macro', () => ({ t: (strings: TemplateStringsArray | string) => (typeof strings === 'string' ? strings : strings[0]) }));
vi.mock('@livekit/components-react', () => ({
  useMediaDeviceSelect: ({ kind }: { kind: string }) => (kind === 'videoinput'
    ? { devices: [], activeDeviceId: devices.activeCamera, setActiveMediaDevice: devices.setActiveCamera }
    : { devices: [], activeDeviceId: 'default', setActiveMediaDevice: vi.fn() }),
}));

import { InitialDeviceSetup } from './SettingsModal';

describe('InitialDeviceSetup', () => {
  afterEach(cleanup);
  beforeEach(() => {
    devices.activeCamera = 'default';
    devices.setActiveCamera.mockClear();
  });

  it('applies the camera from the lobby and then leaves a later change alone', () => {
    const { rerender } = render(<InitialDeviceSetup videoInputDeviceId="front" />);
    expect(devices.setActiveCamera).toHaveBeenCalledWith('front');

    devices.setActiveCamera.mockClear();
    devices.activeCamera = 'front';
    rerender(<InitialDeviceSetup videoInputDeviceId="front" />);
    devices.activeCamera = 'back';
    rerender(<InitialDeviceSetup videoInputDeviceId="front" />);

    expect(devices.setActiveCamera).not.toHaveBeenCalled();
  });
});
