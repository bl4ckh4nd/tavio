import {
  PRESENCE_STALE_AFTER_MS,
  ROOM_ACCESS_MODES,
  getRoomMembership,
  getRoomOrThrow,
  getWorkspaceMembership,
  isRoomManagerRole,
} from "./roomAccess"

// A session survives short gaps: someone reloading, or everyone stepping out for a few minutes.
export const SESSION_IDLE_CLOSE_MS = 10 * 60 * 1000
// Heartbeats arrive every 30s per person; the session row is touched far less often,
// because every patch re-runs the queries that read it.
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000
// One person preparing a room is not a meeting.
export const SESSION_MIN_PEOPLE = 2

export const getOpenSession = async (ctx: any, roomId: any) =>
  await ctx.db
    .query("roomSessions")
    .withIndex("by_room_status", (q: any) => q.eq("roomId", roomId).eq("status", "open"))
    .first()

export const getLastClosedSession = async (ctx: any, roomId: any) => {
  const closed = await ctx.db
    .query("roomSessions")
    .withIndex("by_room_status", (q: any) => q.eq("roomId", roomId).eq("status", "closed"))
    .collect()
  return closed.reduce((latest: any, row: any) => (!latest || row.startedAt > latest.startedAt ? row : latest), null)
}

/** A message belongs to a session from its start until the room has been empty long enough to close it. */
export const sessionWindow = (session: any) => ({
  from: session.startedAt as number,
  until: ((session.endedAt ?? session.lastActiveAt) as number) + SESSION_IDLE_CLOSE_MS,
})

const firstByRoom = async (ctx: any, table: string, roomId: any) =>
  await ctx.db
    .query(table)
    .withIndex("by_room", (q: any) => q.eq("roomId", String(roomId)))
    .first()

/** Closes a session and files what the room held at that moment. */
export const finalizeSession = async (ctx: any, session: any) => {
  const endedAt = session.lastActiveAt
  const messages = await ctx.db
    .query("chatMessages")
    .withIndex("by_room", (q: any) => q.eq("roomId", String(session.roomId)))
    .collect()
  const window = sessionWindow(session)
  const messageCount = messages.filter((m: any) => m.timestamp >= window.from && m.timestamp <= window.until).length

  // Only what changed during the session belongs to its record.
  const board = await firstByRoom(ctx, "whiteboardSnapshots", session.roomId)
  const boardChanged = !!board && board.elements.length > 0 && (board.changedAt ?? 0) >= session.startedAt
  if (boardChanged) {
    const archiveId = await ctx.db.insert("whiteboardArchive", {
      orgId: session.orgId,
      roomId: String(session.roomId),
      elements: board.elements,
      name: board.name,
      boardStartedAt: board.boardStartedAt ?? session.startedAt,
      changedAt: board.changedAt,
      filedAt: endedAt,
      reason: "session",
      sessionId: session._id,
    })
    // The wall still shows exactly this board, so "new board" need not file it a second time.
    await ctx.db.patch(board._id, { sameAsArchiveId: archiveId })
  }
  const replacedDuringSession = await ctx.db
    .query("whiteboardArchive")
    .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
    .first()

  const notes = await firstByRoom(ctx, "meetingDocs", session.roomId)
  const notesChanged = !!notes && (notes.changedAt ?? 0) >= session.startedAt

  await ctx.db.patch(session._id, {
    status: "closed",
    endedAt,
    messageCount,
    hasBoard: boardChanged || !!replacedDuringSession,
    ...(notesChanged ? { notesHtml: notes.contentHtml } : {}),
  })
}

const isGuestId = (userId: string) => userId.startsWith("guest-")

/**
 * Adds the people in the room to a session's list. A guest gets a new id with every join,
 * so a guest who reloads is recognised by name and not listed a second time.
 */
const withNewPeople = (listed: { userId: string; userName: string }[], present: any[]) => {
  const people = [...listed]
  for (const row of present) {
    const known = people.some(
      p => p.userId === row.userId || (isGuestId(p.userId) && isGuestId(row.userId) && p.userName === row.userName),
    )
    if (!known) people.push({ userId: row.userId, userName: row.userName })
  }
  return people
}

/**
 * Called from the presence heartbeat. Opens a session once two people are in the room
 * (or a recording runs), keeps it alive while anyone is there, and replaces one that went stale.
 */
export const touchRoomSession = async (ctx: any, roomId: any, now = Date.now()) => {
  const room = await ctx.db.get(roomId)
  if (!room) return null

  const rows = await ctx.db
    .query("roomPresence")
    .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
    .collect()
  const present = rows.filter((row: any) => row.lastSeen > now - PRESENCE_STALE_AFTER_MS)
  if (present.length === 0) return null

  let open = await getOpenSession(ctx, roomId)
  if (open && now - open.lastActiveAt > SESSION_IDLE_CLOSE_MS) {
    await finalizeSession(ctx, open)
    open = null
  }

  if (!open) {
    if (present.length < SESSION_MIN_PEOPLE && !room.recording) return null
    return await ctx.db.insert("roomSessions", {
      orgId: room.orgId,
      roomId,
      status: "open",
      startedAt: now,
      lastActiveAt: now,
      participants: withNewPeople([], present),
    })
  }

  const participants = withNewPeople(open.participants, present)
  if (participants.length > open.participants.length || now - open.lastActiveAt >= SESSION_TOUCH_INTERVAL_MS) {
    await ctx.db.patch(open._id, { lastActiveAt: now, participants })
  }
  return open._id
}

/** The room's history is for the workspace and the room's hosts, not for whoever holds a guest link. */
export const requireRoomMember = async (ctx: any, roomId: any) => {
  const room = await getRoomOrThrow(ctx, roomId)
  const auth = (ctx as any).auth
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
  if (!identity) throw new Error("You must be signed in to see this room's history")
  // Joining once as a signed-in guest leaves a "Participant" row; that alone does not open the history.
  const workspace = await getWorkspaceMembership(ctx, room.orgId, identity.subject)
  const roomMembership = await getRoomMembership(ctx, roomId, identity.subject)
  const isMember =
    !!workspace ||
    isRoomManagerRole(roomMembership?.role) ||
    (!room.orgId && (room.access !== ROOM_ACCESS_MODES.PASSWORD || !!roomMembership))
  if (!isMember) throw new Error("You do not have access to this room's history")
  return { room, externalId: identity.subject as string }
}

export const isRoomMember = async (ctx: any, roomId: any) => {
  try {
    await requireRoomMember(ctx, roomId)
    return true
  } catch {
    return false
  }
}

/** Removes everything a room's sessions filed. Used when the room itself is deleted. */
export const deleteRoomHistory = async (ctx: any, roomId: any) => {
  const archived = await ctx.db
    .query("whiteboardArchive")
    .withIndex("by_room", (q: any) => q.eq("roomId", String(roomId)))
    .collect()
  const sessions = [
    ...(await ctx.db.query("roomSessions").withIndex("by_room_status", (q: any) => q.eq("roomId", roomId).eq("status", "open")).collect()),
    ...(await ctx.db.query("roomSessions").withIndex("by_room_status", (q: any) => q.eq("roomId", roomId).eq("status", "closed")).collect()),
  ]
  // What the meeting left on the board: comments, the vote, the timer, pages.
  const byRoom = (table: string, id: any) => ctx.db.query(table).withIndex("by_room", (q: any) => q.eq("roomId", id)).collect()
  const left = [
    ...(await byRoom("boardComments", roomId)),
    ...(await byRoom("voteRounds", roomId)),
    ...(await byRoom("roomTimers", roomId)),
    ...(await byRoom("boardPages", String(roomId))),
  ]
  // Images pasted onto the room's boards, with their files.
  const boardImages = (await byRoom("chatUploads", String(roomId))).filter((u: any) => u.keptFor === "board")
  for (const image of boardImages) await ctx.storage.delete(image.storageId)
  left.push(...boardImages)
  await Promise.all([...archived, ...sessions, ...left].map((row: any) => ctx.db.delete(row._id)))
}

/**
 * Where "now" begins in a room: right after the last closed session. A session cannot reopen inside
 * that window, and what someone writes alone before the next meeting already belongs to it.
 */
export const currentFrom = async (ctx: any, roomId: any) => {
  const previous = await getLastClosedSession(ctx, roomId)
  return previous ? sessionWindow(previous).until : 0
}

/**
 * From which moment on a person may see filed boards and chat: members see everything,
 * guests only what belongs to the meeting they are in.
 */
export const visibleSince = async (ctx: any, roomId: any) => {
  if (await isRoomMember(ctx, roomId)) return 0
  return await currentFrom(ctx, roomId)
}
