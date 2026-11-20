import { internalMutation, mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { requireRoomManager, requireRoomResourceAccess } from "./lib/roomAccess"
import {
  SESSION_IDLE_CLOSE_MS,
  currentFrom,
  finalizeSession,
  getOpenSession,
  isRoomMember,
  requireRoomMember,
  sessionWindow,
} from "./lib/sessions"

const commentsOfRoom = async (ctx: any, roomId: any) =>
  await ctx.db.query("boardComments").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).collect()

const commentsOn = (threads: any[], elements: any[]) => {
  const ids = new Set(elements.map((el) => el.id))
  return threads
    .filter((c) => ids.has(c.elementId))
    .map((c) => ({
      elementId: c.elementId as string,
      resolved: c.resolved as boolean,
      replies: (c.replies as any[]).map((r) => ({ name: r.name as string, text: r.text as string, at: r.at as number })),
    }))
}

const MAX_LISTED_SESSIONS = 50
const MAX_SESSION_MESSAGES = 500
// How many earlier sessions the chat can open up.
const MAX_CHAT_BOUNDARIES = 20

const summarize = (session: any) => ({
  id: session._id,
  status: session.status as "open" | "closed",
  startedAt: session.startedAt as number,
  endedAt: (session.endedAt ?? null) as number | null,
  lastActiveAt: session.lastActiveAt as number,
  participantNames: session.participants.map((p: any) => p.userName) as string[],
  messageCount: (session.messageCount ?? null) as number | null,
  hasBoard: !!session.hasBoard,
  hasNotes: typeof session.notesHtml === "string",
})

const sessionsOfRoom = async (ctx: any, roomId: any) =>
  await ctx.db
    .query("roomSessions")
    .withIndex("by_room_started", (q: any) => q.eq("roomId", roomId))
    .collect()

const recordingsOfSession = async (ctx: any, session: any) => {
  const rows = await ctx.db
    .query("recordings")
    .withIndex("by_room", (q: any) => q.eq("roomId", session.roomId))
    .collect()
  const { from, until } = sessionWindow(session)
  // A recording may be what opened the session, so it can start a moment before it.
  return rows.filter((r: any) => r.startedAt >= from - SESSION_IDLE_CLOSE_MS && r.startedAt <= until)
}

const messagesOfSession = async (ctx: any, session: any) => {
  const { from, until } = sessionWindow(session)
  return (
    await ctx.db
      .query("chatMessages")
      .withIndex("by_room", (q: any) => q.eq("roomId", String(session.roomId)))
      .collect()
  )
    .filter((m: any) => m.timestamp >= from && m.timestamp <= until)
    .sort((a: any, b: any) => a.timestamp - b.timestamp)
}

/** A message goes with its reactions and, if it carried an image, with the stored file. */
const deleteChatMessage = async (ctx: any, message: any) => {
  const reactions = await ctx.db
    .query("chatReactions")
    .withIndex("by_message", (q: any) => q.eq("messageId", message._id))
    .collect()
  const uploads = await ctx.db
    .query("chatUploads")
    .withIndex("by_message_created", (q: any) => q.eq("messageId", message._id))
    .collect()
  if (message.attachment?.kind === "image") await ctx.storage.delete(message.attachment.storageId)
  await Promise.all([...reactions, ...uploads].map((row: any) => ctx.db.delete(row._id)))
  await ctx.db.delete(message._id)
}

/**
 * What a meeting client needs: whether a session runs, and where earlier ones began and ended,
 * so the chat can start fresh and fold the past away. Guests get no boundaries of the past.
 */
export const current = query({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const open = await getOpenSession(ctx, args.roomId)
    const member = await isRoomMember(ctx, args.roomId)
    const earlier = member
      ? (await sessionsOfRoom(ctx, args.roomId))
          .filter((s: any) => s.status === "closed")
          .sort((a: any, b: any) => b.startedAt - a.startedAt)
          .slice(0, MAX_CHAT_BOUNDARIES)
          .map((s: any) => ({ id: s._id, startedAt: s.startedAt as number, until: sessionWindow(s).until }))
          .reverse()
      : []
    return {
      current: open ? { id: open._id, startedAt: open.startedAt as number } : null,
      // Everything written after this moment belongs to "now", whether a session runs yet or not.
      currentFrom: await currentFrom(ctx, args.roomId),
      canSeeEarlier: member,
      earlier,
    }
  },
})

export const listForRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    await requireRoomMember(ctx, args.roomId)
    const sessions = (await sessionsOfRoom(ctx, args.roomId))
      .sort((a: any, b: any) => b.startedAt - a.startedAt)
      .slice(0, MAX_LISTED_SESSIONS)
    return await Promise.all(
      sessions.map(async (session: any) => {
        const recordings = await recordingsOfSession(ctx, session)
        return {
          ...summarize(session),
          recordingStatus: (recordings[0]?.status ?? null) as string | null,
        }
      }),
    )
  },
})

export const get = query({
  args: { sessionId: v.id("roomSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId)
    if (!session) return null
    const { room } = await requireRoomMember(ctx, session.roomId)

    const boards = await ctx.db
      .query("whiteboardArchive")
      .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
      .collect()

    const messages = await messagesOfSession(ctx, session)
    const threads = await commentsOfRoom(ctx, session.roomId)

    const recordings = await recordingsOfSession(ctx, session)
    const transcripts = await Promise.all(
      recordings.map((r: any) =>
        ctx.db
          .query("transcripts")
          .withIndex("by_recording", (q: any) => q.eq("recordingId", r._id))
          .first(),
      ),
    )

    // Deleting is a manager's step; the page only offers it to someone who may take it.
    const canDelete = await requireRoomManager(ctx, session.roomId).then(() => true, () => false)

    return {
      ...summarize(session),
      canDelete,
      roomId: session.roomId,
      roomName: room.name as string,
      roomSlug: room.slug as string,
      notesHtml: (session.notesHtml ?? null) as string | null,
      boards: boards
        .sort((a: any, b: any) => a.filedAt - b.filedAt)
        .map((b: any) => ({
          id: b._id,
          name: (b.name ?? null) as string | null,
          reason: b.reason as "replaced" | "session",
          boardStartedAt: b.boardStartedAt as number,
          filedAt: b.filedAt as number,
          elements: b.elements as any[],
          comments: commentsOn(threads, b.elements),
        })),
      messageTotal: messages.length,
      messages: messages.slice(0, MAX_SESSION_MESSAGES).map((m: any) => ({
        id: m._id,
        userName: m.userName as string,
        text: m.text as string,
        timestamp: m.timestamp as number,
        // The record names what was shared; the image itself stays with the chat.
        attachmentKind: (m.attachment?.kind ?? null) as "image" | "gif" | null,
      })),
      recordings: recordings.map((r: any, i: number) => ({
        id: r._id,
        status: r.status as string,
        durationMs: (r.durationMs ?? null) as number | null,
        transcriptStatus: (transcripts[i]?.status ?? null) as string | null,
      })),
    }
  },
})

/**
 * Deletes one session's record: its filed boards, its chat, its notes copy and the row.
 * The room's working state and the recordings stay.
 */
export const remove = mutation({
  args: { sessionId: v.id("roomSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId)
    if (!session) return
    await requireRoomManager(ctx, session.roomId)
    if (session.status === "open") throw new Error("A running session cannot be deleted")
    const boards = await ctx.db
      .query("whiteboardArchive")
      .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
      .collect()
    const messages = await messagesOfSession(ctx, session)
    for (const message of messages) await deleteChatMessage(ctx, message)
    // Comments go with the boards they were on, unless the element is still on the wall or on another filed board.
    const wall = await ctx.db.query("whiteboardSnapshots").withIndex("by_room", (q: any) => q.eq("roomId", session.roomId)).first()
    const others = (await ctx.db.query("whiteboardArchive").withIndex("by_room", (q: any) => q.eq("roomId", String(session.roomId))).collect())
      .filter((b: any) => b.sessionId !== session._id)
    const kept = new Set([wall, ...others].flatMap((b: any) => (b?.elements ?? []) as any[]).map((el) => el.id))
    const filed = new Set(boards.flatMap((b: any) => (b.elements as any[]).map((el) => el.id)).filter((id: string) => !kept.has(id)))
    const comments = (await commentsOfRoom(ctx, session.roomId)).filter((c: any) => filed.has(c.elementId))
    // So do the pages only those boards showed.
    const pageOf = (els: any[]) => els.filter((el) => el.type === "html").map((el) => el.page as string)
    const shownElsewhere = new Set([wall, ...others].flatMap((b: any) => pageOf((b?.elements ?? []) as any[])))
    const pages = (await Promise.all([...new Set(boards.flatMap((b: any) => pageOf(b.elements as any[])))]
      .filter((id) => !shownElsewhere.has(id))
      .map((id) => ctx.db.get(id as any))))
      .filter((page: any) => page && String(page.roomId) === String(session.roomId))
    await Promise.all([...boards, ...comments, ...pages].map((row: any) => ctx.db.delete(row._id)))
    await ctx.db.delete(session._id)
  },
})

/** Cron: files every session whose room has been empty long enough. */
export const closeIdle = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SESSION_IDLE_CLOSE_MS
    const idle = await ctx.db
      .query("roomSessions")
      .withIndex("by_status_active", (q: any) => q.eq("status", "open").lt("lastActiveAt", cutoff))
      .collect()
    for (const session of idle) await finalizeSession(ctx, session)
    return { closed: idle.length }
  },
})
