import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/envValidation', () => ({
  requireEnvForLiveKit: vi.fn(() => ({
    apiKey: 'key',
    apiSecret: 'secret',
    host: 'wss://demo.livekit.cloud',
  })),
  roomServiceHost: (host: string) => host.replace(/^ws/i, 'http'),
}))

vi.mock('./lib/breakouts', () => ({
  isGeneratedBreakoutRoomName: vi.fn((parent: string, name: string) =>
    name.startsWith(`${parent}__breakout__`)),
  resolveBreakoutMode: vi.fn(() => 'native'),
}))

vi.mock('./lib/breakoutCredentials', () => ({
  verifyBreakoutCredential: vi.fn(async () => ({
    identity: 'guest-1',
    mainRoom: 'main',
    name: 'Guest One',
    role: 'Participant',
  })),
}))

const moveParticipant = vi.fn(async () => {})
vi.mock('livekit-server-sdk', () => ({
  AccessToken: class {
    addGrant = vi.fn()
    async toJwt() { return 'room-token' }
  },
  RoomServiceClient: class {
    moveParticipant = moveParticipant
  },
}))

import { switchRoom } from './breakoutActions'

const makeCtx = (session: any, authIdentity: any = null) => ({
  auth: { getUserIdentity: async () => authIdentity },
  runQuery: vi.fn(async (_ref: any, args: any) => {
    if ('slug' in args) return { id: 'room-1', slug: 'main' }
    if ('identity' in args) return false
    return session
  }),
})

describe('breakoutActions.switchRoom authorization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a signed guest credential without an auth identity', async () => {
    const ctx = makeCtx({
      status: 'active',
      rooms: [{ id: 'room-1', name: 'Room 1', livekitRoomName: 'main__breakout__1__1' }],
      assignments: [{ identity: 'guest-1', name: 'Guest One', roomId: 'room-1' }],
    })
    await (switchRoom as any)._handler(ctx, {
      credential: 'guest-credential', roomId: 'room-1', targetRoomId: 'room-1',
    })
    expect(moveParticipant).toHaveBeenCalledWith('main', 'guest-1', 'main__breakout__1__1')
  })

  it('moves an assigned participant back after the session ended', async () => {
    const ctx = makeCtx({
      status: 'ended',
      rooms: [{ id: 'room-1', name: 'Room 1', livekitRoomName: 'main__breakout__1__1' }],
      assignments: [{ identity: 'guest-1', name: 'Guest One', roomId: 'room-1' }],
    })
    await (switchRoom as any)._handler(ctx, {
      credential: 'guest-credential', roomId: 'room-1', sourceRoomId: 'room-1', targetRoomId: 'main',
    })
    expect(moveParticipant).toHaveBeenCalledWith('main__breakout__1__1', 'guest-1', 'main')
  })

  it('uses the actual LiveKit source when a new generation reuses a logical room id', async () => {
    const ctx = makeCtx({
      status: 'active',
      rooms: [{ id: 'room-1', name: 'Room 1', livekitRoomName: 'main__breakout__2__1' }],
      assignments: [{ identity: 'guest-1', name: 'Guest One', roomId: 'room-1' }],
    })
    await (switchRoom as any)._handler(ctx, {
      credential: 'guest-credential', roomId: 'room-1', sourceRoomId: 'room-1',
      currentLivekitRoomName: 'main__breakout__1__1', targetRoomId: 'room-1',
    })
    expect(moveParticipant).toHaveBeenCalledWith('main__breakout__1__1', 'guest-1', 'main__breakout__2__1')
  })

  it('rejects a credential used by a different authenticated identity', async () => {
    const ctx = makeCtx({ status: 'active', rooms: [], assignments: [] }, { subject: 'other-user' })
    await expect((switchRoom as any)._handler(ctx, {
      credential: 'guest-credential', roomId: 'room-1', targetRoomId: 'main',
    })).rejects.toThrow('identity mismatch')
  })
})
