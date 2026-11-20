// Brings the meeting assistant into a room and sends it away again. Needs the LiveKit server API.
"use node"

import { randomUUID } from "crypto"
import { action } from "./_generated/server"
import { v } from "convex/values"
import { AgentDispatchClient, RoomServiceClient, type ParticipantInfo } from "livekit-server-sdk"
import { internal } from "./_generated/api"
import { requireEnvForLiveKit, roomServiceHost } from "./lib/envValidation"
import { issueRoomAccessToken } from "./lib/roomAccess"
import { ASSISTANT_IDENTITY_PREFIX } from "./lib/assistantEdits"

const agentName = () => process.env.ASSISTANT_AGENT_NAME || "tavio-assistant"
// ParticipantInfo.Kind.AGENT and JobStatus JS_PENDING in the LiveKit protocol; the SDK does not export the enums.
const AGENT_KIND = 4
const JOB_PENDING = 0

// Time for a worker to take a dispatch and join; a dispatch older than this with nobody joined is not coming.
const START_WITHIN_MS = 30_000

/**
 * Not yet in the room, but on its way. A job that ran stays "running" after the assistant left,
 * so after the start window only a pending job counts; whether it is there, only the room says.
 */
const isOnItsWay = (d: { state?: { createdAt: bigint; jobs: Array<{ state?: { status: number } }> } }) => {
  if (Date.now() - Number((d.state?.createdAt ?? 0n) / 1_000_000n) < START_WITHIN_MS) return true
  return (d.state?.jobs ?? []).some(job => (job.state?.status ?? JOB_PENDING) === JOB_PENDING)
}

const clients = () => {
  const { apiKey, apiSecret, host } = requireEnvForLiveKit()
  const url = roomServiceHost(host)
  return { dispatch: new AgentDispatchClient(url, apiKey, apiSecret), rooms: new RoomServiceClient(url, apiKey, apiSecret) }
}

export const summon = action({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ alreadyThere: boolean }> => {
    const { livekitRoomName } = await ctx.runQuery(internal.assistant.summonTarget, args)
    const { dispatch, rooms } = clients()
    // A second click must not bring a second assistant. Two clicks at the same moment can both get
    // here; then the worker that joins second leaves again (agent/tavio_assistant/main.py).
    const participants = await rooms.listParticipants(livekitRoomName).catch((): ParticipantInfo[] => [])
    if (participants.some(p => Number(p.kind) === AGENT_KIND)) return { alreadyThere: true }
    const ours = (await dispatch.listDispatch(livekitRoomName)).filter(d => d.agentName === agentName())
    if (ours.some(isOnItsWay)) return { alreadyThere: true }
    for (const stale of ours) await dispatch.deleteDispatch(stale.id, livekitRoomName)

    await ctx.runMutation(internal.assistant.checkSummonLimit, { roomId: args.roomId })
    // The worker gets its own grant for this one room; with it, it can write as the assistant and nothing else.
    const accessToken = await issueRoomAccessToken(ctx, args.roomId, `${ASSISTANT_IDENTITY_PREFIX}${randomUUID()}`)
    await dispatch.createDispatch(livekitRoomName, agentName(), {
      metadata: JSON.stringify({ roomId: args.roomId, accessToken, convexUrl: process.env.CONVEX_CLOUD_URL }),
    })
    return { alreadyThere: false }
  },
})

export const dismiss = action({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { livekitRoomName } = await ctx.runQuery(internal.assistant.summonTarget, args)
    // The grant goes first: whatever happens with LiveKit below, the worker can no longer write.
    await ctx.runMutation(internal.assistant.revokeGrants, { roomId: args.roomId })
    const { dispatch, rooms } = clients()
    for (const d of await dispatch.listDispatch(livekitRoomName)) {
      if (d.agentName === agentName()) await dispatch.deleteDispatch(d.id, livekitRoomName)
    }
    const participants = await rooms.listParticipants(livekitRoomName).catch((): ParticipantInfo[] => [])
    for (const p of participants) {
      // Deleting the dispatch may already have made it leave.
      if (Number(p.kind) === AGENT_KIND) await rooms.removeParticipant(livekitRoomName, p.identity).catch(() => {})
    }
  },
})
