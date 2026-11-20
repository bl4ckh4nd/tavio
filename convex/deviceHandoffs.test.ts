import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/envValidation', () => ({
  requireEnvForLiveKit: vi.fn(() => ({ apiKey: 'key', apiSecret: 'secret', host: 'wss://project.livekit.cloud' })),
}))
vi.mock('./lib/breakouts', () => ({
  resolveBreakoutMode: vi.fn(() => 'native'),
  resolveParticipantBreakoutRoom: vi.fn(() => 'main'),
}))
vi.mock('./lib/breakoutCredentials', () => ({
  verifySessionCredential: vi.fn(),
}))
vi.mock('livekit-server-sdk', () => ({
  AccessToken: class {
    constructor(_key: string, _secret: string, public options: any) {}
    addGrant = vi.fn()
    async toJwt() { return this.options.attributes?.sessionCredential ? 'session-token' : 'room-token' }
  },
}))

import { create, redeem } from './deviceHandoffs'
import { verifySessionCredential } from './lib/breakoutCredentials'

describe('device handoff bearer redemption', () => {
  beforeEach(() => vi.clearAllMocks())

  it('binds create to the authenticated identity while guests remain credential-bound', async () => {
    vi.mocked(verifySessionCredential).mockResolvedValue({
      identity: 'guest-1', mainRoom: 'main', name: 'Guest One', role: 'Participant', issuedAt: undefined,
    })
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: 'different-user' }) },
      runQuery: vi.fn(),
    }
    await expect((create as any)._handler(ctx, {
      credential: 'session-token', roomId: 'room-1', currentRoomId: 'main',
    })).rejects.toThrow('identity mismatch')
  })

  it('accepts a guest handoff even when the target browser has another auth identity', async () => {
    const record: any = {
      _id: 'handoff-1',
      roomId: 'room-1',
      roomSlug: 'main',
      identity: 'guest-1',
      name: 'Guest One',
      role: 'Participant',
      status: 'pending',
      expiresAt: Date.now() + 60_000,
      breakoutRoomId: 'main',
      breakoutGeneration: 0,
      secretHash: 'not-returned-to-client',
    }
    let roomIdQueryCount = 0
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: 'different-signed-in-user' }) },
      runQuery: vi.fn(async (_ref: any, args: any) => {
        if (args.handoffId) return record
        if (args.roomId && roomIdQueryCount++ === 0) return { id: 'room-1', slug: 'main' }
        if (args.identity) return false
        if (args.roomId) return { status: 'active', rooms: [], assignments: [] }
        return null
      }),
      runMutation: vi.fn(async (_ref: any, args: any) => {
        expect(args.identity).toBe('guest-1')
        if (args.tokenHash) return null
        return { ...record, status: 'redeemed', id: 'handoff-1' }
      }),
    }

    const result = await (redeem as any)._handler(ctx, { code: 'handoff-1.secret' })
    expect(result.identity).toBe('guest-1')
    expect(result.token).toBe('room-token')
    expect(result.sessionCredential).toBe('session-token')
    expect(result.breakoutMode).toBe('native')
    expect(result.roomAccessToken).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a handoff created before the meeting was ended for all', async () => {
    const record: any = {
      _id: 'handoff-1', roomId: 'room-1', identity: 'guest-1', status: 'pending',
      createdAt: 1000, expiresAt: Date.now() + 60_000,
    }
    const ctx = {
      runQuery: vi.fn(async (_ref: any, args: any) => (
        args.handoffId ? record : { id: 'room-1', slug: 'main', meetingEndedAt: 2000 }
      )),
      runMutation: vi.fn(),
    }

    await expect((redeem as any)._handler(ctx, { code: 'handoff-1.secret' })).rejects.toThrow(/meeting has ended/i)
    expect(ctx.runMutation).not.toHaveBeenCalled()
  })

  it('refuses session credentials minted before the meeting was ended for all', async () => {
    vi.mocked(verifySessionCredential).mockResolvedValue({
      identity: 'guest-1', mainRoom: 'main', name: 'Guest One', role: 'Participant', issuedAt: 1000,
    })
    const ctx = {
      auth: { getUserIdentity: async () => null },
      runQuery: vi.fn(async () => ({ id: 'room-1', slug: 'main', meetingEndedAt: 2000 })),
    }

    await expect((create as any)._handler(ctx, { credential: 'session-token', roomId: 'room-1' }))
      .rejects.toThrow(/meeting has ended/i)
  })
})
