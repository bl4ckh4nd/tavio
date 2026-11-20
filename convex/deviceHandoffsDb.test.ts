import { describe, expect, it, vi } from 'vitest'
import { claimRecord, cancelRecord, cleanupExpired } from './deviceHandoffsDb'

const makeDb = (initial: any[]) => {
  const records = new Map(initial.map(record => [record._id, record]))
  const patch = vi.fn(async (id: string, value: any) => {
    const record = records.get(id)
    if (record) Object.assign(record, value)
  })
  return {
    records,
    patch,
    get: async (id: string) => records.get(id) ?? null,
    query: () => ({
      withIndex: () => ({
        first: async () => [...records.values()].find(record => record.status === 'pending') ?? null,
        collect: async () => [...records.values()],
      }),
    }),
  }
}

const pending = () => ({
  _id: 'handoff-1',
  identity: 'guest-1',
  secretHash: 'a'.repeat(64),
  status: 'pending',
  expiresAt: 200,
  roomId: 'room-1',
})

describe('device handoff database gate', () => {
  it('atomically changes pending to redeemed and rejects replay', async () => {
    const db = makeDb([pending()])
    const ctx = { db }
    const args = { handoffId: 'handoff-1', identity: 'guest-1', secretHash: 'a'.repeat(64), now: 100 }

    await expect((claimRecord as any)._handler(ctx, args)).resolves.toMatchObject({ identity: 'guest-1' })
    await expect((claimRecord as any)._handler(ctx, args)).rejects.toThrow('already used')
    expect(db.records.get('handoff-1')?.status).toBe('redeemed')
  })

  it('rejects an expired or wrong-secret claim and permits cancellation only while pending', async () => {
    const expiredDb = makeDb([{ ...pending(), expiresAt: 10 }])
    await expect((claimRecord as any)._handler({ db: expiredDb }, {
      handoffId: 'handoff-1', identity: 'guest-1', secretHash: 'a'.repeat(64), now: 10,
    })).rejects.toThrow('expired')

    const wrongDb = makeDb([pending()])
    await expect((claimRecord as any)._handler({ db: wrongDb }, {
      handoffId: 'handoff-1', identity: 'guest-1', secretHash: 'b'.repeat(64), now: 1,
    })).rejects.toThrow('invalid')

    const cancelDb = makeDb([pending()])
    await expect((cancelRecord as any)._handler({ db: cancelDb }, {
      handoffId: 'handoff-1', identity: 'guest-1', now: 50,
    })).resolves.toBe(true)
    await expect((cancelRecord as any)._handler({ db: cancelDb }, {
      handoffId: 'handoff-1', identity: 'guest-1', now: 51,
    })).resolves.toBe(false)
  })

  it('marks pending records expired during scheduled cleanup', async () => {
    const db = makeDb([pending(), { ...pending(), _id: 'redeemed', status: 'redeemed' }])
    await expect((cleanupExpired as any)._handler({ db }, { now: 200 })).resolves.toBe(2)
    expect(db.records.get('handoff-1')?.status).toBe('expired')
    expect(db.records.get('redeemed')?.status).toBe('redeemed')
  })
})
