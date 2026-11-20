import { internalMutation, internalQuery } from './_generated/server'
import { v } from 'convex/values'

const mapRecord = (record: any) => {
  if (!record) return null
  const { _id, _creationTime, secretHash, ...safe } = record
  return { id: _id, ...safe }
}

export const getById = internalQuery({
  args: { handoffId: v.id('deviceHandoffs') },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.handoffId)
    return record ? { ...record, id: record._id } : null
  },
})

export const createRecord = internalMutation({
  args: {
    roomId: v.id('rooms'),
    roomSlug: v.string(),
    identity: v.string(),
    name: v.string(),
    role: v.string(),
    secretHash: v.string(),
    breakoutRoomId: v.string(),
    breakoutGeneration: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('deviceHandoffs')
      .withIndex('by_room_identity_status', q => q.eq('roomId', args.roomId).eq('identity', args.identity).eq('status', 'pending'))
      .first()
    if (existing) await ctx.db.patch(existing._id, { status: 'cancelled', cancelledAt: args.createdAt })
    return ctx.db.insert('deviceHandoffs', { ...args, status: 'pending' })
  },
})

export const claimRecord = internalMutation({
  args: {
    handoffId: v.id('deviceHandoffs'),
    identity: v.string(),
    secretHash: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.handoffId)
    // The mutation is the one-time gate: concurrent redemptions see the
    // status transition in the same transaction and only one can claim it.
    if (!record || record.status !== 'pending' || record.identity !== args.identity || record.expiresAt <= args.now || record.secretHash !== args.secretHash) {
      throw new Error('Handoff code is invalid, expired, or already used')
    }
    await ctx.db.patch(record._id, { status: 'redeemed', redeemedAt: args.now })
    return mapRecord(record)
  },
})

export const cancelRecord = internalMutation({
  args: { handoffId: v.id('deviceHandoffs'), identity: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.handoffId)
    if (!record || record.identity !== args.identity || record.status !== 'pending') return false
    await ctx.db.patch(record._id, { status: 'cancelled', cancelledAt: args.now })
    return true
  },
})

export const cleanupExpired = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const expired = await ctx.db.query('deviceHandoffs').withIndex('by_expires', q => q.lte('expiresAt', args.now)).collect()
    for (const record of expired) {
      if (record.status === 'pending') await ctx.db.patch(record._id, { status: 'expired' })
    }
    return expired.length
  },
})
