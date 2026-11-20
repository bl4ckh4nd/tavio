import { mutation, query, internalQuery } from "./_generated/server"
import { v } from "convex/values"
import {
  getRoomOrThrow,
  getRoomMembership,
  getWorkspaceMembership,
  isRoomManagerRole,
  isWorkspaceAdminRole,
  requireRoomManager,
  requireRoomResourceAccess,
} from "./lib/roomAccess"
import { makeBreakoutRoomName } from "./lib/breakouts"

const identityFromAssignment = (assignment: { identity?: string; userId?: string }) =>
  assignment.identity?.trim() || assignment.userId?.trim() || null

const mapSession = (session: any) => {
  const { _id, _creationTime, ...rest } = session
  return { id: _id, ...rest }
}

const roomInput = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.string()),
  participantIds: v.optional(v.array(v.string())),
})

const assignmentInput = v.object({
  identity: v.optional(v.string()),
  name: v.optional(v.string()),
  userId: v.optional(v.string()),
  roomId: v.string(),
})

export const getForRoom = query({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const session = await ctx.db
      .query("breakoutSessions")
      .withIndex("by_parent", q => q.eq("parentRoomId", args.roomId))
      .first()
    return session ? mapSession(session) : null
  },
})

export const getActiveForRoom = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("breakoutSessions")
      .withIndex("by_parent_status", q => q.eq("parentRoomId", args.roomId).eq("status", "active"))
      .first()
    return session ? mapSession(session) : null
  },
})

export const getLatestForRoom = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("breakoutSessions")
      .withIndex("by_parent", q => q.eq("parentRoomId", args.roomId))
      .first()
    return session ? mapSession(session) : null
  },
})

export const getManagerState = internalQuery({
  args: { roomId: v.id("rooms"), identity: v.string() },
  handler: async (ctx, args) => {
    const room = await getRoomOrThrow(ctx, args.roomId)
    const [roomMembership, workspaceMembership] = await Promise.all([
      getRoomMembership(ctx, args.roomId, args.identity),
      getWorkspaceMembership(ctx, (room as any).orgId, args.identity),
    ])
    return isRoomManagerRole(roomMembership?.role) || isWorkspaceAdminRole(workspaceMembership?.role)
  },
})

export const start = mutation({
  args: {
    roomId: v.id("rooms"),
    roomCount: v.optional(v.number()),
    rooms: v.optional(v.array(roomInput)),
    assignments: v.optional(v.array(assignmentInput)),
  },
  handler: async (ctx, args) => {
    const identity = (ctx as any).auth?.getUserIdentity
      ? await (ctx as any).auth.getUserIdentity()
      : null
    if (!identity) throw new Error("You must be signed in to manage breakout rooms")

    const { room } = await requireRoomManager(ctx, args.roomId)
    const requestedCount = args.rooms?.length ?? args.roomCount ?? 2
    if (!Number.isInteger(requestedCount) || requestedCount < 2 || requestedCount > 10) {
      throw new Error("Breakout rooms must contain between 2 and 10 rooms")
    }

    const active = await ctx.db
      .query("breakoutSessions")
      .withIndex("by_parent_status", q => q.eq("parentRoomId", args.roomId).eq("status", "active"))
      .first()
    if (active) throw new Error("A breakout session is already active")

    const existing = await ctx.db
      .query("breakoutSessions")
      .withIndex("by_parent", q => q.eq("parentRoomId", args.roomId))
      .first()
    const generation = (existing?.generation ?? 0) + 1
    const rooms = Array.from({ length: requestedCount }, (_, index) => ({
      id: `room-${generation}-${index + 1}`,
      name: `Room ${index + 1}`,
      livekitRoomName: makeBreakoutRoomName(room.slug, generation, index),
    }))
    const allowedRoomIds = new Set(rooms.map(entry => entry.id))
    const inputRoomIds = new Map(
      (args.rooms ?? []).map((input, index) => [input.id, rooms[index].id]),
    )
    const assignmentMap = new Map<string, { roomId: string; name: string }>()
    for (const assignment of args.assignments ?? []) {
      const identityValue = identityFromAssignment(assignment)
      if (!identityValue) throw new Error("Breakout assignment identity is required")
      const canonicalRoomId = inputRoomIds.get(assignment.roomId) ?? assignment.roomId
      if (!allowedRoomIds.has(canonicalRoomId)) {
        throw new Error("Breakout assignment target is not part of this session")
      }
      const name = assignment.name?.trim() || identityValue
      assignmentMap.set(identityValue, { roomId: canonicalRoomId, name })
    }
    for (const [index, input] of (args.rooms ?? []).entries()) {
      for (const participantId of input.participantIds ?? []) {
        const identityValue = participantId.trim()
        if (!identityValue) throw new Error("Breakout assignment identity is required")
        assignmentMap.set(identityValue, {
          roomId: rooms[index].id,
          name: assignmentMap.get(identityValue)?.name || identityValue,
        })
      }
    }

    const session = {
      parentRoomId: args.roomId,
      generation,
      status: "active" as const,
      rooms,
      assignments: Array.from(assignmentMap, ([identityValue, assignment]) => ({
        identity: identityValue,
        name: assignment.name,
        roomId: assignment.roomId,
      })),
      createdAt: Date.now(),
      endedAt: undefined,
    }
    if (existing) {
      await ctx.db.patch(existing._id, session)
      return mapSession(await ctx.db.get(existing._id))
    }
    const id = await ctx.db.insert("breakoutSessions", session)
    return mapSession(await ctx.db.get(id))
  },
})

export const end = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const identity = (ctx as any).auth?.getUserIdentity
      ? await (ctx as any).auth.getUserIdentity()
      : null
    if (!identity) throw new Error("You must be signed in to manage breakout rooms")
    await getRoomOrThrow(ctx, args.roomId)
    await requireRoomManager(ctx, args.roomId)
    const session = await ctx.db
      .query("breakoutSessions")
      .withIndex("by_parent_status", q => q.eq("parentRoomId", args.roomId).eq("status", "active"))
      .first()
    if (!session) return null
    await ctx.db.patch(session._id, { status: "ended", endedAt: Date.now() })
    return mapSession(await ctx.db.get(session._id))
  },
})
