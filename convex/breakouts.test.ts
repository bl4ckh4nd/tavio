import { describe, expect, it, vi } from 'vitest'
import { end, start } from './breakouts'

const unauthenticatedContext = {
  auth: { getUserIdentity: async () => null },
}

describe('breakouts manager authorization', () => {
  it('rejects unauthenticated session start', async () => {
    await expect((start as any)._handler(unauthenticatedContext, { roomId: 'room-1', roomCount: 2 }))
      .rejects.toThrow('signed in')
  })

  it('rejects unauthenticated session end', async () => {
    await expect((end as any)._handler(unauthenticatedContext, { roomId: 'room-1' }))
      .rejects.toThrow('signed in')
  })

  it('rejects an assignment target that is not one of the requested rooms', async () => {
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: 'manager' }) },
      db: {
        get: async () => ({ slug: 'main', orgId: undefined }),
        query: () => ({
          withIndex: (name: string) => ({ first: async () => name === 'by_room_user' ? { role: 'Host' } : null }),
        }),
        insert: vi.fn(),
      },
    }

    await expect((start as any)._handler(ctx, {
      roomId: 'room-1',
      rooms: [{ id: 'draft-a' }, { id: 'draft-b' }],
      assignments: [{ identity: 'guest-1', roomId: 'not-a-room' }],
    })).rejects.toThrow('assignment target')
  })

  it('reuses the parent session row for the next generation', async () => {
    const existing = {
      _id: 'session-1',
      generation: 3,
      status: 'ended',
      rooms: [],
      assignments: [],
    } as any
    const patch = vi.fn(async (_id: string, value: any) => Object.assign(existing, value))
    const insert = vi.fn()
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: 'manager' }) },
      db: {
        get: async (id: string) => id === 'room-1' ? { slug: 'main', orgId: undefined } : existing,
        query: () => ({
          withIndex: (name: string) => ({
            first: async () => name === 'by_parent' ? existing : name === 'by_room_user' ? { role: 'Host' } : null,
          }),
        }),
        patch,
        insert,
      },
    }

    const result = await (start as any)._handler(ctx, {
      roomId: 'room-1',
      rooms: [{ id: 'draft-a' }, { id: 'draft-b' }],
      assignments: [{ identity: 'guest-1', name: 'Guest One', roomId: 'draft-a' }],
    })

    expect(patch).toHaveBeenCalledOnce()
    expect(insert).not.toHaveBeenCalled()
    expect(result.generation).toBe(4)
    expect(result.assignments).toEqual([{ identity: 'guest-1', name: 'Guest One', roomId: 'room-4-1' }])
  })
})
