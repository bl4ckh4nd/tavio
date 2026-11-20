import { RateLimiter, MINUTE, HOUR } from "@convex-dev/rate-limiter"
import { components } from "../_generated/api"
import { getWorkspaceMembership } from "./roomAccess"

const rateLimiter = new RateLimiter(components.rateLimiter, {
  chatSend: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 30 },
  // Everyone without a role in the room's workspace, together: guest ids are new on every join and accounts cost nothing,
  // so a per-participant limit alone does not bound a room.
  chatSendGuests: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 120 },
  roomCreate: { kind: "fixed window", rate: 5, period: HOUR },
  tokenIssue: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  // Guests have no id of their own, so the guests of one room share this; other rooms are not affected.
  tokenIssueGuests: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 30 },
  whiteboardSave: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 120 },
  meetingDocSave: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 60 },
  uploadFile: { kind: "fixed window", rate: 5, period: HOUR },
  // Members: per person. Guests: one shared allowance per room, because a guest id is new on every join.
  chatUploadMember: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },
  chatUploadGuests: { kind: "token bucket", rate: 10, period: HOUR, capacity: 5 },
  // Per room: the worker has no identity of its own, and one room's assistant must not use up another's.
  assistantEdit: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 10 },
  assistantSummon: { kind: "fixed window", rate: 10, period: HOUR },
  // REST API, per key. Shards keep parallel requests of one key from conflicting on a single row.
  apiRequest: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 60, shards: 4 },
})

/**
 * REST API requests, counted per API key.
 */
export async function checkApiRateLimit(ctx: any, keyId: string) {
  await rateLimiter.limit(ctx, "apiRequest", { key: keyId, throws: true })
}

/**
 * The assistant's writes and summons, counted per room.
 */
export async function checkAssistantRateLimit(ctx: any, roomId: string, what: "edit" | "summon" = "edit") {
  await rateLimiter.limit(ctx, what === "edit" ? "assistantEdit" : "assistantSummon", { key: roomId, throws: true })
}

/**
 * Chat messages, reactions and board comments: 30 a minute per participant (the verified identity),
 * and for guests, signed in or not, also 120 a minute for all guests of the room together.
 * A guest is anyone without a role in the room's workspace, as for LiveKit tokens.
 */
export async function checkChatRateLimit(ctx: any, participant: string, roomId: string) {
  await rateLimiter.limit(ctx, "chatSend", { key: participant, throws: true })
  const room = await ctx.db.get(roomId)
  if (!(await getWorkspaceMembership(ctx, room?.orgId, participant))) {
    await rateLimiter.limit(ctx, "chatSendGuests", { key: `guests:${roomId}`, throws: true })
  }
}

/**
 * Chat image uploads. The key is the member's id, or `guests:<roomId>` for all guests of a room.
 */
export async function checkChatUploadRateLimit(ctx: any, key: string) {
  const name = key.startsWith("guests:") ? "chatUploadGuests" : "chatUploadMember"
  await rateLimiter.limit(ctx, name, { key, throws: true })
}

/**
 * Rate limiting for room creation
 * Limit: 5 rooms per hour per user
 */
export async function checkRoomCreateRateLimit(ctx: any) {
  const auth = (ctx as any).auth
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
  if (!identity) {
    throw new Error("Must be signed in to create rooms")
  }
  const key = identity.subject

  await rateLimiter.limit(ctx, "roomCreate", { key, throws: true })
}

/**
 * LiveKit tokens. The key is the member's id (10 a minute), or `guests:<roomId>` for all guests of a room (30 a minute).
 */
export async function checkTokenRateLimit(ctx: any, key: string) {
  const name = key.startsWith("guests:") ? "tokenIssueGuests" : "tokenIssue"
  await rateLimiter.limit(ctx, name, { key, throws: true })
}

/**
 * Rate limiting for whiteboard saves
 * Limit: 120 saves per minute per user (allows for interactive drawing)
 */
export async function checkWhiteboardRateLimit(ctx: any) {
  const auth = (ctx as any).auth
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
  const key = identity?.subject || "anonymous"

  await rateLimiter.limit(ctx, "whiteboardSave", { key, throws: true })
}

/**
 * Rate limiting for meeting document saves
 * Limit: 60 saves per minute per user
 */
export async function checkMeetingDocRateLimit(ctx: any) {
  const auth = (ctx as any).auth
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
  const key = identity?.subject || "anonymous"

  await rateLimiter.limit(ctx, "meetingDocSave", { key, throws: true })
}

/**
 * Rate limiting for file uploads
 * Limit: 5 uploads per hour per user
 */
export async function checkUploadRateLimit(ctx: any) {
  const auth = (ctx as any).auth
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
  if (!identity) {
    throw new Error("Must be signed in to upload files")
  }
  const key = identity.subject

  await rateLimiter.limit(ctx, "uploadFile", { key, throws: true })
}
