import { ConvexError, v } from "convex/values"
import { httpAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { countPresent, deleteRoom, insertRoom } from "./rooms"
import { hashRoomAccessToken } from "./lib/roomAccess"
import { refuse, type RefusalCode } from "./lib/refusal"

// The public REST API at /v1, for servers holding a workspace API key. Every handler acts for the key's
// workspace only: a room or recording of another workspace answers 404, the same as one that does not exist.

const MAX_LISTED = 100

const iso = (ms: number | undefined | null) => (typeof ms === "number" ? new Date(ms).toISOString() : null)

const roomUrl = (slug: string) => {
  const site = process.env.SITE_URL?.replace(/\/+$/, "")
  return site ? `${site}/room/${slug}` : null
}

const presentRoom = async (ctx: any, room: any) => ({
  id: room._id as string,
  name: room.name as string,
  slug: room.slug as string,
  url: roomUrl(room.slug),
  access: room.access as string,
  activeParticipants: await countPresent(ctx, room._id),
  createdAt: iso(room._creationTime),
})

const presentRecording = (recording: any, transcriptStatus: string | null) => ({
  id: recording._id as string,
  roomId: recording.roomId as string,
  status: recording.status as string,
  startedAt: iso(recording.startedAt),
  endedAt: iso(recording.stoppedAt),
  durationMs: (recording.durationMs ?? null) as number | null,
  transcriptStatus,
})

/** A room of the workspace by id or slug; null for anything else. */
const findRoom = async (ctx: any, orgId: string, ref: string) => {
  const id = ctx.db.normalizeId("rooms", ref)
  const room = id
    ? await ctx.db.get(id)
    : await ctx.db.query("rooms").withIndex("by_slug", (q: any) => q.eq("slug", ref)).first()
  return room && room.orgId === orgId ? room : null
}

const findRecording = async (ctx: any, orgId: string, ref: string) => {
  const id = ctx.db.normalizeId("recordings", ref)
  const recording = id ? await ctx.db.get(id) : null
  return recording && recording.orgId === orgId ? recording : null
}

const transcriptOf = async (ctx: any, recordingId: any) =>
  await ctx.db
    .query("transcripts")
    .withIndex("by_recording", (q: any) => q.eq("recordingId", recordingId))
    .first()

export const listRooms = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", q => q.eq("orgId", args.orgId))
      .collect()
    return await Promise.all(rooms.map(room => presentRoom(ctx, room)))
  },
})

export const getRoom = internalQuery({
  args: { orgId: v.id("organizations"), room: v.string() },
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args.orgId, args.room)
    return room ? await presentRoom(ctx, room) : null
  },
})

export const createRoom = internalMutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    slug: v.optional(v.string()),
    access: v.optional(v.string()),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const room = await insertRoom(ctx, args.orgId, {
      name: args.name,
      slug: args.slug ?? generateSlug(args.name),
      type: "WORKSPACE",
      access: args.access ?? "OPEN",
      password: args.password,
    })
    return await presentRoom(ctx, room)
  },
})

export const deleteRoomOfOrg = internalMutation({
  args: { orgId: v.id("organizations"), room: v.string() },
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args.orgId, args.room)
    if (!room) return false
    await deleteRoom(ctx, room._id)
    return true
  },
})

export const listSessions = internalQuery({
  args: { orgId: v.id("organizations"), room: v.string() },
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args.orgId, args.room)
    if (!room) return null
    const sessions = await ctx.db
      .query("roomSessions")
      .withIndex("by_room_started", q => q.eq("roomId", room._id))
      .order("desc")
      .take(MAX_LISTED)
    return sessions.map(session => ({
      id: session._id as string,
      status: session.status,
      startedAt: iso(session.startedAt),
      endedAt: iso(session.endedAt),
      participantNames: session.participants.map((p: any) => p.userName as string),
      messageCount: session.messageCount ?? null,
    }))
  },
})

export const listRecordings = internalQuery({
  args: { orgId: v.id("organizations"), room: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let recordings
    if (args.room === undefined) {
      recordings = await ctx.db
        .query("recordings")
        .withIndex("by_org", q => q.eq("orgId", args.orgId))
        .order("desc")
        .take(MAX_LISTED)
    } else {
      const room = await findRoom(ctx, args.orgId, args.room)
      if (!room) return []
      recordings = await ctx.db
        .query("recordings")
        .withIndex("by_room", q => q.eq("roomId", room._id))
        .order("desc")
        .take(MAX_LISTED)
    }
    return await Promise.all(recordings
      .filter(recording => recording.orgId === args.orgId)
      .map(async recording => presentRecording(recording, (await transcriptOf(ctx, recording._id))?.status ?? null)))
  },
})

export const getRecording = internalQuery({
  args: { orgId: v.id("organizations"), recording: v.string() },
  handler: async (ctx, args) => {
    const recording = await findRecording(ctx, args.orgId, args.recording)
    if (!recording) return null
    const transcript = await transcriptOf(ctx, recording._id)
    return {
      recording: presentRecording(recording, transcript?.status ?? null),
      storagePath: (recording.storagePath ?? null) as string | null,
    }
  },
})

export const getTranscript = internalQuery({
  args: { orgId: v.id("organizations"), recording: v.string() },
  handler: async (ctx, args) => {
    const recording = await findRecording(ctx, args.orgId, args.recording)
    const transcript = recording ? await transcriptOf(ctx, recording._id) : null
    if (!transcript) return null
    return {
      status: transcript.status as string,
      text: (transcript.text ?? null) as string | null,
      segments: transcript.segments ?? [],
    }
  },
})

/** "Weekly sync" → "weekly-sync-k3x9qa". The suffix keeps generated links from colliding. */
const generateSlug = (name: string) => {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")
  const suffix = Array.from({ length: 6 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")
  return base ? `${base}-${suffix}` : `room-${suffix}`
}

// --- HTTP ---

const STATUS: Record<RefusalCode | "rate_limited" | "method_not_allowed" | "internal", number> = {
  invalid_request: 400,
  unauthorized: 401,
  plan_limit: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? headers : { "Content-Type": "application/json", ...headers },
  })

const fail = (code: keyof typeof STATUS, message: string, headers?: Record<string, string>) =>
  json(STATUS[code], { error: { code, message } }, headers)

const notFound = (what: string) => fail("not_found", `${what} not found.`)
const notAllowed = (allowed: string) => fail("method_not_allowed", `Use ${allowed} on this path.`, { Allow: allowed })

const optionalString = (body: Record<string, unknown>, field: string) => {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string") throw refuse("invalid_request", `${field} must be a string.`)
  return value
}

const readRoomInput = async (request: Request) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw refuse("invalid_request", "The body must be JSON.")
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw refuse("invalid_request", "The body must be a JSON object.")
  }
  const fields = body as Record<string, unknown>
  const name = optionalString(fields, "name")
  if (!name?.trim()) throw refuse("invalid_request", "name is required.")
  return {
    name: name.trim(),
    slug: optionalString(fields, "slug"),
    access: optionalString(fields, "access"),
    password: optionalString(fields, "password"),
  }
}

type Ctx = { runQuery: any; runMutation: any; runAction: any }

const route = async (ctx: Ctx, request: Request, orgId: string): Promise<Response> => {
  const url = new URL(request.url)
  const [version, collection, rawRef, sub, ...rest] = url.pathname.split("/").filter(Boolean)
  let ref: string | undefined
  try {
    ref = rawRef === undefined ? undefined : decodeURIComponent(rawRef)
  } catch {
    return notFound("Path")
  }
  const method = request.method
  if (version !== "v1" || rest.length > 0) return notFound("Path")

  if (collection === "rooms" && ref === undefined) {
    if (method === "GET") return json(200, { data: await ctx.runQuery(internal.restApi.listRooms, { orgId }) })
    if (method === "POST") {
      const input = await readRoomInput(request)
      return json(201, await ctx.runMutation(internal.restApi.createRoom, { orgId, ...input }))
    }
    return notAllowed("GET, POST")
  }
  if (collection === "rooms" && sub === undefined) {
    if (method === "GET") {
      const room = await ctx.runQuery(internal.restApi.getRoom, { orgId, room: ref })
      return room ? json(200, room) : notFound("Room")
    }
    if (method === "DELETE") {
      const deleted = await ctx.runMutation(internal.restApi.deleteRoomOfOrg, { orgId, room: ref })
      return deleted ? json(204, null) : notFound("Room")
    }
    return notAllowed("GET, DELETE")
  }
  if (collection === "rooms" && sub === "sessions") {
    if (method !== "GET") return notAllowed("GET")
    const sessions = await ctx.runQuery(internal.restApi.listSessions, { orgId, room: ref })
    return sessions ? json(200, { data: sessions }) : notFound("Room")
  }

  if (collection === "recordings" && ref === undefined) {
    if (method !== "GET") return notAllowed("GET")
    const room = url.searchParams.get("room") ?? undefined
    return json(200, { data: await ctx.runQuery(internal.restApi.listRecordings, { orgId, room }) })
  }
  if (collection === "recordings" && sub === undefined) {
    if (method !== "GET") return notAllowed("GET")
    const found = await ctx.runQuery(internal.restApi.getRecording, { orgId, recording: ref })
    if (!found) return notFound("Recording")
    const downloadUrl = found.storagePath
      ? await ctx.runAction(internal.recordingActions.signedDownloadUrl, { storagePath: found.storagePath })
      : null
    return json(200, { ...found.recording, downloadUrl })
  }
  if (collection === "recordings" && sub === "transcript") {
    if (method !== "GET") return notAllowed("GET")
    const transcript = await ctx.runQuery(internal.restApi.getTranscript, { orgId, recording: ref })
    return transcript ? json(200, transcript) : notFound("Transcript")
  }

  return notFound("Path")
}

/** One request to /v1: authenticate the key, then route. Exported for the contract tests. */
export const handleApiRequest = async (ctx: Ctx, request: Request): Promise<Response> => {
  try {
    const token = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (!token) return fail("unauthorized", "Send your API key as: Authorization: Bearer <key>.")
    const { orgId } = await ctx.runMutation(internal.apiKeys.authenticate, { tokenHash: await hashRoomAccessToken(token) })
    return await route(ctx, request, orgId)
  } catch (error) {
    const data = error instanceof ConvexError ? (error.data as any) : null
    if (data?.kind === "RateLimited") {
      const seconds = Math.max(1, Math.ceil((data.retryAfter ?? 1000) / 1000))
      return fail("rate_limited", "Too many requests with this key. Try again later.", { "Retry-After": String(seconds) })
    }
    if (data && data.code in STATUS) return fail(data.code, data.message)
    console.error("[restApi]", error)
    return fail("internal", "Something went wrong on our side.")
  }
}

export const restApi = httpAction(handleApiRequest)
