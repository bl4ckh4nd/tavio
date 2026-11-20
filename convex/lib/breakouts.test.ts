import { describe, expect, it, vi } from 'vitest'
let tokenClaims: any
vi.mock('livekit-server-sdk', () => ({
  TokenVerifier: class {
    async verify() {
      return tokenClaims
    }
  },
}))
import {
  isGeneratedBreakoutRoomName,
  resolveBreakoutMode,
  resolveParticipantBreakoutRoom,
} from './breakouts'
import { verifyBreakoutCredential } from './breakoutCredentials'

describe('breakout transport', () => {
  it('rejects a session credential carrying a room-join grant', async () => {
    tokenClaims = {
      sub: 'guest-1',
      video: { roomJoin: true },
      attributes: { breakoutCredential: '1', mainRoom: 'main-room' },
    }
    await expect(verifyBreakoutCredential('room-token', 'key', 'secret')).rejects.toThrow('Invalid breakout')
  })

  it('selects native only for LiveKit Cloud in auto mode', () => {
    expect(resolveBreakoutMode('wss://project.livekit.cloud', 'auto')).toBe('native')
    expect(resolveBreakoutMode('wss://localhost:7880', 'auto')).toBe('reconnect')
    expect(resolveBreakoutMode('wss://localhost:7880', 'native')).toBe('native')
  })

  it('verifies a signed guest credential without requiring auth', async () => {
    tokenClaims = {
      sub: 'guest-1',
      attributes: { breakoutCredential: '1', mainRoom: 'main-room', name: 'Guest One', role: 'Participant' },
    }
    const credential = 'signed-guest-credential'
    await expect(verifyBreakoutCredential(credential, 'key', 'secret')).resolves.toEqual({
      identity: 'guest-1',
      mainRoom: 'main-room',
      name: 'Guest One',
      role: 'Participant',
    })
  })

  it('keeps participant assignment resolution tied to the current session generation', () => {
    expect(resolveParticipantBreakoutRoom({
      status: 'active', generation: 2,
      rooms: [{ id: 'room-1', livekitRoomName: 'main__breakout__2__1' }],
      assignments: [{ identity: 'guest-1', roomId: 'room-1' }],
    }, 'guest-1', false, 'room-1', undefined, 1)).toBe('room-1')
    expect(resolveParticipantBreakoutRoom({
      status: 'active', generation: 2,
      rooms: [{ id: 'room-1', livekitRoomName: 'main__breakout__2__1' }],
      assignments: [],
    }, 'manager', true, 'room-1', 'main__breakout__2__1', 1)).toBe('main')
  })

  it('strictly recognizes generated room names for any positive generation', () => {
    expect(isGeneratedBreakoutRoomName('main-room', 'main-room__breakout__1__2')).toBe(true)
    expect(isGeneratedBreakoutRoomName('main-room', 'main-room__breakout__0__1')).toBe(false)
    expect(isGeneratedBreakoutRoomName('main-room', 'other__breakout__1__1')).toBe(false)
    expect(isGeneratedBreakoutRoomName('main.room', 'mainXroom__breakout__1__1')).toBe(false)
  })
})
