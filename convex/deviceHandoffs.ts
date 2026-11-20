"use node"

import { createHash, randomBytes, timingSafeEqual } from "crypto"
import { AccessToken } from "livekit-server-sdk"
import { action } from "./_generated/server"
import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import { requireEnvForLiveKit } from "./lib/envValidation"
import { resolveBreakoutMode, resolveParticipantBreakoutRoom } from "./lib/breakouts"
import { verifySessionCredential } from "./lib/breakoutCredentials"
import { issueRoomAccessToken, predatesMeetingEnd } from "./lib/roomAccess"
import { livekitRoomNameFor } from "./lib/roomIdentity"

const handoffCode = v.string()
const roomIdArg = v.id("rooms")
const HANDOFF_TTL_MS = 5 * 60 * 1000

const authIdentity = async (ctx: any) => {
  const auth = (ctx as any).auth
  return auth?.getUserIdentity ? await auth.getUserIdentity() : null
}

const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex")

const parseCode = (code: string) => {
  const separator = code.indexOf(".")
  if (separator <= 0 || separator === code.length - 1) throw new Error("Invalid handoff code")
  return { id: code.slice(0, separator), secret: code.slice(separator + 1) }
}

const sameHash = (actual: string, expected: string) => {
  const left = Buffer.from(actual, "hex")
  const right = Buffer.from(expected, "hex")
  return left.length === right.length && timingSafeEqual(left, right)
}

const getSession = (ctx: any, roomId: any) =>
  ctx.runQuery((internal as any).breakouts.getActiveForRoom, { roomId })

const roomToken = async (apiKey: string, apiSecret: string, identity: string, name: string, role: string, roomName: string) => {
  const token = new AccessToken(apiKey, apiSecret, { identity, name, attributes: { role }, ttl: 15 * 60 })
  token.addGrant({ roomJoin: true, room: roomName })
  return token.toJwt()
}

const sessionToken = async (apiKey: string, apiSecret: string, identity: string, name: string, role: string, mainRoom: string) => {
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: 6 * 60 * 60,
    attributes: { sessionCredential: "1", breakoutCredential: "1", issuedAt: String(Date.now()), mainRoom, parentRoom: mainRoom, name, role },
  })
  return token.toJwt()
}

const resolveTargetRoom = (mainRoomName: string, session: any, breakoutRoomId: string) => {
  if (!session || breakoutRoomId === "main") return mainRoomName
  return session.rooms?.find((entry: any) => entry.id === breakoutRoomId)?.livekitRoomName || mainRoomName
}

const validateCredentialAndRoom = async (ctx: any, credential: string, roomId: any) => {
  const { apiKey, apiSecret, host } = requireEnvForLiveKit()
  const identity = await verifySessionCredential(credential, apiKey, apiSecret)
  const auth = await authIdentity(ctx)
  if (auth && auth.subject !== identity.identity) throw new Error("Session credential identity mismatch")
  const room: any = await ctx.runQuery(api.rooms.getBySlug, { slug: identity.mainRoom })
  if (!room || room.id !== roomId) throw new Error("Session credential is bound to another room")
  if (predatesMeetingEnd(room, identity.issuedAt)) throw new Error("This meeting has ended")
  return { apiKey, apiSecret, host, identity, auth, room }
}

export const create = action({
  args: {
    credential: v.string(),
    roomId: roomIdArg,
    currentRoomId: v.optional(v.string()),
    currentLivekitRoomName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const state = await validateCredentialAndRoom(ctx, args.credential, args.roomId)
    const now = Date.now()
    await ctx.runMutation((internal as any).deviceHandoffsDb.cleanupExpired, { now })
    const session = await getSession(ctx, args.roomId)
    const isManager = state.auth
      ? await ctx.runQuery((internal as any).breakouts.getManagerState, { roomId: args.roomId, identity: state.identity.identity })
      : false
    const breakoutRoomId = resolveParticipantBreakoutRoom(session, state.identity.identity, !!isManager, args.currentRoomId, args.currentLivekitRoomName)
    const breakoutGeneration = session?.status === "active" ? session.generation : 0
    const secret = randomBytes(32).toString("base64url")
    const expiresAt = now + HANDOFF_TTL_MS
    const id = await ctx.runMutation((internal as any).deviceHandoffsDb.createRecord, {
      roomId: args.roomId,
      roomSlug: state.room.slug,
      identity: state.identity.identity,
      name: state.identity.name,
      role: state.identity.role,
      secretHash: hashSecret(secret),
      breakoutRoomId,
      breakoutGeneration,
      createdAt: now,
      expiresAt,
    })
    await ctx.scheduler.runAfter(HANDOFF_TTL_MS, (internal as any).deviceHandoffsDb.cleanupExpired, { now: expiresAt })
    return { code: `${id}.${secret}`, roomSlug: state.room.slug, name: state.identity.name, role: state.identity.role, expiresAt }
  },
})

export const inspect = action({
  args: { code: handoffCode },
  handler: async (ctx, args): Promise<any> => {
    const { id, secret } = parseCode(args.code)
    let record: any
    try {
      record = await ctx.runQuery((internal as any).deviceHandoffsDb.getById, { handoffId: id })
    } catch {
      throw new Error("Invalid handoff code")
    }
    if (!record || record.status !== "pending" || record.expiresAt <= Date.now()) throw new Error("Handoff code is invalid or expired")
    // The code is a bearer secret. No secret or hash is returned to the client.
    if (!sameHash(record.secretHash, hashSecret(secret))) throw new Error("Handoff code is invalid")
    const room: any = await ctx.runQuery((internal as any).rooms.getForDeviceHandoff, { roomId: record.roomId })
    if (!room) throw new Error("Room not found")
    return { roomId: record.roomId, roomSlug: room.slug, room, name: record.name, role: record.role, expiresAt: record.expiresAt }
  },
})

export const redeem = action({
  args: { code: handoffCode },
  handler: async (ctx, args): Promise<any> => {
    const { id, secret } = parseCode(args.code)
    const { apiKey, apiSecret, host } = requireEnvForLiveKit()
    let record: any
    try {
      record = await ctx.runQuery((internal as any).deviceHandoffsDb.getById, { handoffId: id })
    } catch {
      throw new Error("Invalid handoff code")
    }
    if (!record || record.status !== "pending" || record.expiresAt <= Date.now()) throw new Error("Handoff code is invalid or expired")
    const room: any = await ctx.runQuery((internal as any).rooms.getForDeviceHandoff, { roomId: record.roomId })
    if (!room) throw new Error("Room not found")
    if (predatesMeetingEnd(room, record.createdAt)) throw new Error("This meeting has ended")
    const roomId = record.roomId
    const claimed: any = await ctx.runMutation((internal as any).deviceHandoffsDb.claimRecord, { handoffId: id, identity: record.identity, secretHash: hashSecret(secret), now: Date.now() })
    const session = await getSession(ctx, roomId)
    const isManager = await ctx.runQuery((internal as any).breakouts.getManagerState, { roomId, identity: record.identity })
    const breakoutRoomId = resolveParticipantBreakoutRoom(session, record.identity, !!isManager, claimed.breakoutRoomId, undefined, claimed.breakoutGeneration)
    const targetRoom = resolveTargetRoom(livekitRoomNameFor(room), session, breakoutRoomId)
    return {
      token: await roomToken(apiKey, apiSecret, record.identity, claimed.name, claimed.role, targetRoom),
      sessionCredential: await sessionToken(apiKey, apiSecret, record.identity, claimed.name, claimed.role, room.slug),
      roomAccessToken: await issueRoomAccessToken(ctx, roomId, record.identity),
      breakoutMode: resolveBreakoutMode(host),
      url: host,
      roomId,
      roomSlug: room.slug,
      livekitRoomName: livekitRoomNameFor(room),
      identity: record.identity,
      name: claimed.name,
      role: claimed.role,
      currentRoomId: breakoutRoomId,
    }
  },
})

export const cancel = action({
  args: { credential: v.string(), code: handoffCode, roomId: roomIdArg },
  handler: async (ctx, args): Promise<boolean> => {
    const state = await validateCredentialAndRoom(ctx, args.credential, args.roomId)
    const { id } = parseCode(args.code)
    return ctx.runMutation((internal as any).deviceHandoffsDb.cancelRecord, { handoffId: id, identity: state.identity.identity, now: Date.now() })
  },
})
