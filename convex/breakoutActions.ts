// Convex actions that call the LiveKit Room Service API.
"use node"

import { action } from "./_generated/server"
import { v } from "convex/values"
import { AccessToken, RoomServiceClient } from "livekit-server-sdk"
import { api, internal } from "./_generated/api"
import { requireEnvForLiveKit, roomServiceHost } from "./lib/envValidation"
import {
  isGeneratedBreakoutRoomName,
  resolveBreakoutMode,
} from "./lib/breakouts"
import { verifyBreakoutCredential } from "./lib/breakoutCredentials"
import { predatesMeetingEnd } from "./lib/roomAccess"
import { livekitRoomNameFor } from "./lib/roomIdentity"

const roomIdArg = v.id("rooms")

const authIdentity = async (ctx: any) => {
  const auth = (ctx as any).auth
  return auth?.getUserIdentity ? await auth.getUserIdentity() : null
}

const getRoomAndSession = async (
  ctx: any,
  roomId: any,
  credential: string,
  allowNoActive = false,
): Promise<any> => {
  const { apiKey, apiSecret, host } = requireEnvForLiveKit()
  const tokenIdentity = await verifyBreakoutCredential(credential, apiKey, apiSecret)
  const room: any = await ctx.runQuery(api.rooms.getBySlug, { slug: tokenIdentity.mainRoom })
  if (!room || room.id !== roomId) throw new Error("Breakout credential is bound to another room")
  if (predatesMeetingEnd(room, tokenIdentity.issuedAt)) throw new Error("This meeting has ended")
  const session: any = await ctx.runQuery(
    (internal as any).breakouts[allowNoActive ? "getLatestForRoom" : "getActiveForRoom"],
    { roomId },
  )
  if (!session && !allowNoActive) throw new Error("No active breakout session")
  return { apiKey, apiSecret, host, tokenIdentity, room, session }
}

const getManagerState = async (ctx: any, roomId: any, identity: string) =>
  ctx.runQuery((internal as any).breakouts.getManagerState, { roomId, identity })

const targetRoom = (session: any, mainRoomName: string, roomId: string) => {
  if (roomId === "main" || roomId === "") return { id: "main", livekitRoomName: mainRoomName }
  const room = session.rooms.find((entry: any) => entry.id === roomId)
  if (!room) throw new Error("Target room is not part of the active breakout session")
  return room
}

const issueRoomToken = async (
  apiKey: string,
  apiSecret: string,
  identity: string,
  roomName: string,
  name: string,
  role: string,
) => {
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    attributes: { role },
    ttl: 15 * 60,
  })
  token.addGrant({ roomJoin: true, room: roomName })
  return token.toJwt()
}

export const switchRoom = action({
  args: {
    credential: v.string(),
    roomId: roomIdArg,
    sourceRoomId: v.optional(v.string()),
    currentLivekitRoomName: v.optional(v.string()),
    targetRoomId: v.string(),
  },
  handler: async (ctx, args): Promise<any> => {
    const auth = await authIdentity(ctx)
    const state: any = await getRoomAndSession(
      ctx,
      args.roomId,
      args.credential,
      args.targetRoomId === "main",
    )
    if (auth && state.tokenIdentity.identity !== auth.subject) {
      throw new Error("Breakout credential identity mismatch")
    }
    const credentialIdentity = state.tokenIdentity.identity
    const manager = auth ? await getManagerState(ctx, args.roomId, auth.subject) : false
    const sourceId = args.sourceRoomId || "main"
    if (!state.session) {
      if (args.targetRoomId === "main") {
        return { mode: resolveBreakoutMode(state.host), targetRoom: livekitRoomNameFor(state.room) }
      }
      throw new Error("No active breakout session")
    }
    const mainRoomName = livekitRoomNameFor(state.room)
    const target = targetRoom(state.session, mainRoomName, args.targetRoomId)
    const assignment = state.session.assignments.find((entry: any) => entry.identity === credentialIdentity)
    const assignedId = assignment?.roomId
    if (!manager && args.targetRoomId === "main" && state.session.status === "active") {
      throw new Error("Participants return to the main room when the breakout session ends")
    }
    if (!manager && args.targetRoomId !== assignedId && args.targetRoomId !== "main") {
      throw new Error("You may only join your assigned breakout room")
    }
    const source = sourceId === "main"
      ? { id: "main", livekitRoomName: mainRoomName }
      : args.currentLivekitRoomName
        ? { id: sourceId, livekitRoomName: args.currentLivekitRoomName }
        : targetRoom(state.session, mainRoomName, sourceId)
    const sourceName = args.currentLivekitRoomName ?? source.livekitRoomName
    if (sourceName !== mainRoomName && !isGeneratedBreakoutRoomName(state.room.slug, sourceName)) {
      throw new Error("Current LiveKit room is not part of this meeting")
    }
    if (sourceName === target.livekitRoomName) return { mode: resolveBreakoutMode(state.host), targetRoom: target.livekitRoomName }

    const mode = resolveBreakoutMode(state.host)
    if (mode === "native") {
      await new RoomServiceClient(roomServiceHost(state.host), state.apiKey, state.apiSecret)
        .moveParticipant(sourceName, credentialIdentity, target.livekitRoomName)
      return { mode, targetRoom: target.livekitRoomName }
    }
    return {
      mode,
      targetRoom: target.livekitRoomName,
      token: await issueRoomToken(state.apiKey, state.apiSecret, credentialIdentity, target.livekitRoomName, state.tokenIdentity.name, state.tokenIdentity.role),
      url: state.host,
    }
  },
})

export const issueReconnectToken = action({
  args: {
    credential: v.string(),
    roomId: roomIdArg,
    currentRoomId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const auth = await authIdentity(ctx)
    const state: any = await getRoomAndSession(ctx, args.roomId, args.credential, true)
    if (auth && state.tokenIdentity.identity !== auth.subject) {
      throw new Error("Breakout credential identity mismatch")
    }
    const credentialIdentity = state.tokenIdentity.identity
    const session = state.session
    const manager = auth ? await getManagerState(ctx, args.roomId, auth.subject) : false
    if (!session) {
      return {
        mode: resolveBreakoutMode(state.host),
        targetRoom: livekitRoomNameFor(state.room),
        token: await issueRoomToken(state.apiKey, state.apiSecret, credentialIdentity, livekitRoomNameFor(state.room), state.tokenIdentity.name, state.tokenIdentity.role),
        url: state.host,
      }
    }
    if (session.status === "ended") {
      return {
        mode: resolveBreakoutMode(state.host),
        targetRoom: livekitRoomNameFor(state.room),
        token: await issueRoomToken(state.apiKey, state.apiSecret, credentialIdentity, livekitRoomNameFor(state.room), state.tokenIdentity.name, state.tokenIdentity.role),
        url: state.host,
      }
    }
    const assignment = session.assignments.find((entry: any) => entry.identity === credentialIdentity)
    const assignedId = assignment?.roomId
    const currentId = args.currentRoomId || "main"
    if (!manager && currentId !== (assignedId || "main")) {
      throw new Error("Current room does not match your breakout assignment")
    }
    const targetId = manager ? currentId : assignedId || "main"
    const target = targetRoom(session, livekitRoomNameFor(state.room), targetId)
    return {
      mode: resolveBreakoutMode(state.host),
      targetRoom: target.livekitRoomName,
      token: await issueRoomToken(state.apiKey, state.apiSecret, credentialIdentity, target.livekitRoomName, state.tokenIdentity.name, state.tokenIdentity.role),
      url: state.host,
    }
  },
})
