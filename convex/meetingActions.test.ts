import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./lib/envValidation', () => ({
  requireEnvForLiveKit: vi.fn(() => ({
    apiKey: 'key',
    apiSecret: 'secret',
    host: 'wss://demo.livekit.cloud',
  })),
  roomServiceHost: (host: string) => host.replace(/^ws/i, 'http'),
}))

const deleteRoom = vi.fn(async (_roomName: string) => {})
vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    deleteRoom = deleteRoom
  },
}))

import { endForAll } from './meetingActions'

const makeCtx = (livekitRoomNames: string[]) => ({
  runQuery: vi.fn(async () => ({ livekitRoomNames })),
  runMutation: vi.fn(async () => null),
  scheduler: { runAfter: vi.fn(async () => null) },
})

describe('meetingActions.endForAll', () => {
  beforeEach(() => vi.clearAllMocks())

  it('closes breakout rooms before the parent and ends the breakout session', async () => {
    const ctx = makeCtx(['main__breakout__1__1', 'main__breakout__1__2', 'main'])

    const result = await (endForAll as any)._handler(ctx, { roomId: 'room-1' })

    expect(deleteRoom.mock.calls.map(call => call[0])).toEqual([
      'main__breakout__1__1',
      'main__breakout__1__2',
      'main',
    ])
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), { roomId: 'room-1' })
    expect(result).toEqual({ closedRooms: 3 })
  })

  it('blocks guest rejoins and revokes pre-end grants only after clients had time to leave', async () => {
    const ctx = makeCtx(['main'])

    await (endForAll as any)._handler(ctx, { roomId: 'room-1' })

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      { roomId: 'room-1', endedAt: expect.any(Number) },
    )
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      60_000,
      expect.anything(),
      { roomId: 'room-1', issuedBefore: expect.any(Number) },
    )
  })

  it('still closes the remaining rooms when one was never created on the server', async () => {
    const ctx = makeCtx(['main__breakout__1__1', 'main'])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    deleteRoom.mockRejectedValueOnce(new Error('room not found'))

    const result = await (endForAll as any)._handler(ctx, { roomId: 'room-1' })

    expect(deleteRoom).toHaveBeenCalledTimes(2)
    expect(deleteRoom).toHaveBeenLastCalledWith('main')
    expect(result).toEqual({ closedRooms: 1 })
    consoleError.mockRestore()
  })

  it('tells the host when the main meeting room could not be closed, instead of reporting success', async () => {
    const ctx = makeCtx(['main'])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    deleteRoom.mockRejectedValueOnce(new Error('fetch failed'))

    await expect((endForAll as any)._handler(ctx, { roomId: 'room-1' })).rejects.toThrow(/could not end the meeting/i)
    expect(ctx.runMutation).not.toHaveBeenCalled()
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
