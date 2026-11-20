import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState } from 'livekit-client';

const state = vi.hoisted(() => ({
  connection: 'connected' as string,
  locale: 'de',
  attributes: { role: 'Host' } as Record<string, string>,
  setAttributes: vi.fn(async (_: Record<string, string>) => {}),
}));

vi.mock('@livekit/components-react', () => ({
  useLocalParticipant: () => ({ localParticipant: { attributes: state.attributes, setAttributes: state.setAttributes } }),
  useConnectionState: () => state.connection,
}));
vi.mock('@lingui/react', () => ({ useLingui: () => ({ i18n: { locale: state.locale } }) }));

import { useAnnounceLanguage } from './useAnnounceLanguage';

describe('useAnnounceLanguage', () => {
  beforeEach(() => {
    state.connection = ConnectionState.Connected;
    state.locale = 'de';
    state.attributes = { role: 'Host' };
    state.setAttributes.mockClear();
  });

  it('tells the room the language of the app once connected', () => {
    renderHook(() => useAnnounceLanguage());
    expect(state.setAttributes).toHaveBeenCalledWith({ lang: 'de' });
  });

  it('waits until the connection is there', () => {
    state.connection = ConnectionState.Connecting;
    renderHook(() => useAnnounceLanguage());
    expect(state.setAttributes).not.toHaveBeenCalled();
  });

  it('does not repeat what the room already knows', () => {
    state.attributes = { role: 'Host', lang: 'de' };
    renderHook(() => useAnnounceLanguage());
    expect(state.setAttributes).not.toHaveBeenCalled();
  });

  it('says it again when the person switches language', () => {
    const { rerender } = renderHook(() => useAnnounceLanguage());
    state.locale = 'en';
    rerender();
    expect(state.setAttributes).toHaveBeenLastCalledWith({ lang: 'en' });
  });

  it('survives a refused update', () => {
    state.setAttributes.mockRejectedValueOnce(new Error('offline'));
    expect(() => renderHook(() => useAnnounceLanguage())).not.toThrow();
  });
});
