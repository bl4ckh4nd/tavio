import { afterEach, describe, expect, it } from 'vitest';
import { requireEnvForAuth, requireEnvForLiveKit, roomServiceHost } from './envValidation';

describe('env validation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws with the list of missing LiveKit vars', () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    delete process.env.LIVEKIT_HOST;

    expect(() => requireEnvForLiveKit()).toThrow(/LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_HOST/);
  });

  it('enforces auth env URL shape and secret strength', () => {
    process.env.BETTER_AUTH_SECRET = 'short-secret';
    process.env.SITE_URL = 'localhost:3333';
    process.env.CONVEX_SITE_URL = 'http://bad.convex.site';

    expect(() => requireEnvForAuth()).toThrow();

    process.env.BETTER_AUTH_SECRET = '12345678901234567890123456789012';
    process.env.SITE_URL = 'http://localhost:3333';
    process.env.CONVEX_SITE_URL = 'https://example.convex.site';

    expect(() => requireEnvForAuth()).not.toThrow();
  });

  it('allows local HTTP Convex site URLs', () => {
    process.env.BETTER_AUTH_SECRET = '12345678901234567890123456789012';
    process.env.SITE_URL = 'http://localhost:3334';

    for (const host of ['localhost', '127.0.0.1']) {
      process.env.CONVEX_SITE_URL = `http://${host}:3211`;
      expect(() => requireEnvForAuth()).not.toThrow();
    }
  });

  it('rejects remote HTTP Convex site URLs', () => {
    process.env.BETTER_AUTH_SECRET = '12345678901234567890123456789012';
    process.env.SITE_URL = 'http://localhost:3334';
    process.env.CONVEX_SITE_URL = 'http://convex.example.com';

    expect(() => requireEnvForAuth()).toThrow(/Invalid CONVEX_SITE_URL/);
  });
});

describe('roomServiceHost', () => {
  afterEach(() => {
    delete process.env.LIVEKIT_API_HOST;
  });

  it('keeps plain-text LiveKit servers on http and TLS servers on https', () => {
    expect(roomServiceHost('ws://localhost:7880')).toBe('http://localhost:7880');
    expect(roomServiceHost('wss://demo.livekit.cloud')).toBe('https://demo.livekit.cloud');
  });

  it('prefers LIVEKIT_API_HOST when the server reaches LiveKit on a different address', () => {
    process.env.LIVEKIT_API_HOST = 'ws://livekit:7880';
    expect(roomServiceHost('wss://meet.example.com')).toBe('http://livekit:7880');
  });
});
