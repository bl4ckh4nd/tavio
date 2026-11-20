import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { checkWhiteboardRateLimit } from "./lib/rateLimit"
import { getRoomOrThrow, requireRoomResourceAccess } from "./lib/roomAccess"
import { getOpenSession, visibleSince } from "./lib/sessions"

const MAX_LISTED_BOARDS = 30
const MAX_BOARD_NAME = 60

const wallOf = async (ctx: any, roomId: any) =>
  await ctx.db
    .query("whiteboardSnapshots")
    .withIndex("by_room", (q: any) => q.eq("roomId", String(roomId)))
    .first()

const filedBoardOf = async (ctx: any, roomId: any, archiveId: any) => {
  const filed = await ctx.db.get(archiveId)
  if (!filed || filed.roomId !== String(roomId)) throw new Error("Board not found")
  if (filed.filedAt < (await visibleSince(ctx, roomId))) throw new Error("Board not found")
  return filed
}

/** Files the board on the wall unless it is empty or an untouched copy of a board that is already filed. */
const fileWall = async (ctx: any, room: any, wall: any, now: number) => {
  if (!wall || wall.elements.length === 0) return null
  if (wall.sameAsArchiveId && (await ctx.db.get(wall.sameAsArchiveId))) return wall.sameAsArchiveId
  const open = await getOpenSession(ctx, room._id)
  return await ctx.db.insert("whiteboardArchive", {
    orgId: room.orgId,
    roomId: String(room._id),
    elements: wall.elements,
    name: wall.name,
    boardStartedAt: wall.boardStartedAt ?? wall.changedAt ?? now,
    changedAt: wall.changedAt,
    filedAt: now,
    reason: "replaced",
    sessionId: open?._id,
  })
}

const cleanName = (name: string | undefined) => {
  const trimmed = (name ?? "").replace(/\s+/g, " ").trim()
  if (trimmed.length > MAX_BOARD_NAME) throw new Error(`Board name is too long (max ${MAX_BOARD_NAME} characters)`)
  return trimmed || undefined
}

/** Filed boards, newest first, without their elements. */
export const list = query({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const since = await visibleSince(ctx, args.roomId)
    const rows = await ctx.db
      .query("whiteboardArchive")
      .withIndex("by_room", (q: any) => q.eq("roomId", String(args.roomId)).gte("filedAt", since))
      .collect()
    return rows
      .sort((a: any, b: any) => b.filedAt - a.filedAt)
      .slice(0, MAX_LISTED_BOARDS)
      .map((b: any) => ({
        id: b._id,
        name: (b.name ?? null) as string | null,
        boardStartedAt: b.boardStartedAt as number,
        filedAt: b.filedAt as number,
        reason: b.reason as "replaced" | "session",
        elementCount: b.elements.length as number,
      }))
  },
})

export const get = query({
  args: { roomId: v.id("rooms"), archiveId: v.id("whiteboardArchive"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const filed = await ctx.db.get(args.archiveId)
    if (!filed || filed.roomId !== String(args.roomId)) return null
    if (filed.filedAt < (await visibleSince(ctx, args.roomId))) return null
    return {
      id: filed._id,
      name: (filed.name ?? null) as string | null,
      boardStartedAt: filed.boardStartedAt as number,
      filedAt: filed.filedAt as number,
      reason: filed.reason as "replaced" | "session",
      elements: filed.elements as any[],
    }
  },
})

/**
 * Hangs up a fresh board. The old one goes to the room's history; elements named in keepElementIds
 * stay on the wall, so a meeting can keep its agenda and drop the scribbles.
 */
export const startNew = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.optional(v.string()),
    keepElementIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await checkWhiteboardRateLimit(ctx)
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const room = await getRoomOrThrow(ctx, args.roomId)
    const wall = await wallOf(ctx, args.roomId)
    if (!wall || wall.elements.length === 0) return { archiveId: null, generation: wall?.generation ?? 0 }

    const keep = new Set(args.keepElementIds ?? [])
    const kept = wall.elements.filter((element: any) => keep.has(element.id))
    // Keeping everything would file a copy and change nothing.
    if (kept.length === wall.elements.length) return { archiveId: null, generation: wall.generation ?? 0 }

    const now = Date.now()
    const archiveId = await fileWall(ctx, room, wall, now)
    const generation = (wall.generation ?? 0) + 1
    await ctx.db.patch(wall._id, {
      elements: kept,
      name: undefined,
      boardStartedAt: now,
      changedAt: undefined,
      placedAt: now,
      generation,
      sameAsArchiveId: undefined,
    })
    return { archiveId, generation }
  },
})

/**
 * Takes "new board" back: the filed board returns to the wall and leaves the history again.
 * Whatever was drawn in the meantime stays on top of it.
 */
export const undoStartNew = mutation({
  args: { roomId: v.id("rooms"), archiveId: v.id("whiteboardArchive"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await checkWhiteboardRateLimit(ctx)
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const filed = await filedBoardOf(ctx, args.roomId, args.archiveId)
    const wall = await wallOf(ctx, args.roomId)
    if (!wall) throw new Error("Board not found")

    const known = new Set(filed.elements.map((element: any) => element.id))
    const drawnSince = wall.elements.filter((element: any) => !known.has(element.id))
    // Only a board filed by that very "new board" leaves the history; a session's record stays where it is.
    const filedByThatStep = filed.reason === "replaced" && filed.filedAt === wall.placedAt
    const now = Date.now()
    await ctx.db.patch(wall._id, {
      elements: [...filed.elements, ...drawnSince],
      name: filed.name,
      boardStartedAt: filed.boardStartedAt,
      changedAt: drawnSince.length > 0 ? now : filed.changedAt,
      placedAt: now,
      generation: (wall.generation ?? 0) + 1,
      sameAsArchiveId: filedByThatStep || drawnSince.length > 0 ? undefined : filed._id,
    })
    if (filedByThatStep) await ctx.db.delete(filed._id)
  },
})

/** Puts a copy of a filed board on the wall. The filed board stays; the board it replaces is filed first. */
export const restore = mutation({
  args: { roomId: v.id("rooms"), archiveId: v.id("whiteboardArchive"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await checkWhiteboardRateLimit(ctx)
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const room = await getRoomOrThrow(ctx, args.roomId)
    const filed = await filedBoardOf(ctx, args.roomId, args.archiveId)
    const wall = await wallOf(ctx, args.roomId)
    const now = Date.now()
    const next = {
      elements: filed.elements,
      name: filed.name,
      boardStartedAt: filed.boardStartedAt,
      changedAt: filed.changedAt,
      placedAt: now,
      sameAsArchiveId: filed._id,
    }
    if (!wall) {
      await ctx.db.insert("whiteboardSnapshots", { roomId: String(args.roomId), generation: 1, ...next })
      return { archiveId: null, generation: 1 }
    }
    const archiveId = wall.sameAsArchiveId === filed._id ? null : await fileWall(ctx, room, wall, now)
    const generation = (wall.generation ?? 0) + 1
    await ctx.db.patch(wall._id, { ...next, generation })
    return { archiveId, generation }
  },
})

/** Names the board on the wall, or a filed one. An empty name removes it. */
export const rename = mutation({
  args: {
    roomId: v.id("rooms"),
    name: v.string(),
    archiveId: v.optional(v.id("whiteboardArchive")),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await checkWhiteboardRateLimit(ctx)
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const name = cleanName(args.name)
    if (args.archiveId) {
      const filed = await filedBoardOf(ctx, args.roomId, args.archiveId)
      await ctx.db.patch(filed._id, { name })
      return
    }
    const wall = await wallOf(ctx, args.roomId)
    if (wall) {
      await ctx.db.patch(wall._id, { name })
      return
    }
    await ctx.db.insert("whiteboardSnapshots", { roomId: String(args.roomId), elements: [], name, generation: 0 })
  },
})
