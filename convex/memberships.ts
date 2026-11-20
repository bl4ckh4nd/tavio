import { internalMutation, query, mutation } from "./_generated/server"
import { v } from "convex/values"
import { getRoomMembership, requireRoomManager } from "./lib/roomAccess"

const requireAuthIdentity = async (ctx: any) => {
  const auth = (ctx as any).auth
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
  if (!identity) {
    throw new Error("You must be signed in to manage room members")
  }
  return identity
}

export const getForRoom = query({
  args: { roomId: v.id("rooms"), userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireAuthIdentity(ctx)
    if (identity.subject !== args.userId) {
      await requireRoomManager(ctx, args.roomId)
    }

    const membership = await getRoomMembership(ctx, args.roomId, args.userId)
    if (!membership) return null
    const { _id, _creationTime, ...rest } = membership
    return { id: _id, ...rest }
  }
})

export const listForRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    await requireRoomManager(ctx, args.roomId)
    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_room_user", q => q.eq("roomId", args.roomId))
      .collect()

    return rows.map(m => {
      const { _id, _creationTime, ...rest } = m
      return { id: _id, ...rest }
    })
  }
})

export const add = mutation({
  args: {
    roomId: v.id("rooms"),
    userId: v.string(),
    role: v.string()
  },
  handler: async (ctx, args) => {
    await requireAuthIdentity(ctx)
    const { room } = await requireRoomManager(ctx, args.roomId)

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_room_user", q => q.eq("roomId", args.roomId).eq("userId", args.userId))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role })
      return
    }

    await ctx.db.insert("memberships", {
      orgId: room.orgId,
      roomId: args.roomId,
      userId: args.userId,
      role: args.role,
      createdAt: Date.now()
    })
  }
})

export const remove = mutation({
  args: { id: v.id("memberships") },
  handler: async (ctx, args) => {
    await requireAuthIdentity(ctx)
    const membership = await ctx.db.get(args.id)
    if (!membership) return
    await requireRoomManager(ctx, membership.roomId)
    await ctx.db.delete(args.id)
  }
})

// SECURITY: Non-atomic ensureHostForFirstMember removed to prevent race conditions.
// Use ensureHostForFirstMemberAtomic instead, which uses Convex's transactional guarantees.

/**
 * Atomically ensure first member becomes host.
 * Uses Convex's transactional guarantees to prevent race conditions.
 * This is the recommended version to prevent concurrent users from both becoming hosts.
 */
export const ensureHostForFirstMemberAtomic = internalMutation({
  args: { roomId: v.id("rooms"), userId: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId)
    if (!room) {
      throw new Error("Room not found")
    }

    // Check if user already has membership
    const existingForUser = await ctx.db
      .query("memberships")
      .withIndex("by_room_user", q => q.eq("roomId", args.roomId).eq("userId", args.userId))
      .first()
    if (existingForUser) {
      return existingForUser
    }

    // Atomic check: does ANY membership exist?
    const anyMembership = await ctx.db
      .query("memberships")
      .withIndex("by_room_user", q => q.eq("roomId", args.roomId))
      .first()

    // If no memberships exist, this user becomes Host
    // Convex guarantees this query+insert is atomic within the mutation
    const role = anyMembership ? "Participant" : "Host"

    const id = await ctx.db.insert("memberships", {
      orgId: room.orgId,
      roomId: args.roomId,
      userId: args.userId,
      role,
      createdAt: Date.now()
    })

    return await ctx.db.get(id)
  }
})
