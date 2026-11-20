import { ConvexError } from "convex/values"
import { internal } from "../_generated/api"
import { ROOM_ACCESS_REQUIRED } from "./roomIdentity"

export const ROOM_ACCESS_MODES = {
  OPEN: "OPEN",
  PASSWORD: "PASSWORD",
  MEMBERS: "MEMBERS",
} as const

export const WORKSPACE_ADMIN_ROLES = ["OWNER", "ADMIN"] as const
export const ROOM_MANAGER_ROLES = ["Host", "Admin"] as const

export const ROOM_ACCESS_GRANT_TTL_MS = 6 * 60 * 60 * 1000
// Heartbeats tick every 30s, so this tolerates two missed ticks.
export const PRESENCE_STALE_AFTER_MS = 90 * 1000
// Matches the LiveKit token TTL: after this no pre-end token can reopen the room.
export const MEETING_END_REJOIN_BLOCK_MS = 15 * 60 * 1000

type RoomAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

const getAuthIdentity = async (ctx: any) => {
  const auth = (ctx as any).auth
  return auth?.getUserIdentity ? await auth.getUserIdentity() : null
}

export const getRoomOrThrow = async (ctx: any, roomId: any) => {
  const room = await ctx.db.get(roomId)
  if (!room) {
    throw new Error("Room not found")
  }
  return room
}

export const isWorkspaceAdminRole = (role: string | undefined) =>
  !!role && WORKSPACE_ADMIN_ROLES.includes(role as (typeof WORKSPACE_ADMIN_ROLES)[number])

export const isRoomManagerRole = (role: string | undefined) =>
  !!role && ROOM_MANAGER_ROLES.includes(role as (typeof ROOM_MANAGER_ROLES)[number])

export const getWorkspaceMembership = async (ctx: any, orgId: any, userId: string) => {
  if (!orgId) {
    return null
  }

  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect()
  return memberships.find((m: any) => m.orgId === orgId) ?? null
}

export const getRoomMembership = async (ctx: any, roomId: any, userId: string) => {
  return await ctx.db
    .query("memberships")
    .withIndex("by_room_user", (q: any) => q.eq("roomId", roomId).eq("userId", userId))
    .first()
}

export const hashRoomAccessToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
}

/** Call from actions only: returns the bearer token, stores just its hash. */
export const issueRoomAccessToken = async (ctx: any, roomId: any, identity: string) => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
  await ctx.runMutation((internal as any).rooms.createAccessGrant, {
    roomId,
    identity,
    tokenHash: await hashRoomAccessToken(token),
    expiresAt: Date.now() + ROOM_ACCESS_GRANT_TTL_MS,
  })
  return token
}

export const findRoomAccessGrant = async (ctx: any, roomId: any, accessToken: string | undefined) => {
  if (!accessToken) return null
  const tokenHash = await hashRoomAccessToken(accessToken)
  const grant = await ctx.db
    .query("roomAccessGrants")
    .withIndex("by_token_hash", (q: any) => q.eq("tokenHash", tokenHash))
    .first()
  if (!grant || grant.roomId !== roomId || grant.expiresAt <= Date.now()) return null
  return grant
}

export const isMeetingEndBlockActive = (room: any, now = Date.now()) => {
  const endedAt = room?.meetingEndedAt
  if (!endedAt) return false
  return (room.meetingReopenedAt ?? 0) < endedAt && now < endedAt + MEETING_END_REJOIN_BLOCK_MS
}

export const predatesMeetingEnd = (room: any, issuedAt: number | undefined) =>
  !!room?.meetingEndedAt && (issuedAt ?? 0) < room.meetingEndedAt

export const canAccessRoomResource = async (
  ctx: any,
  roomId: any,
  accessToken?: string,
): Promise<RoomAccessDecision> => {
  const room = await getRoomOrThrow(ctx, roomId)
  const access = (room as any).access

  if (await findRoomAccessGrant(ctx, roomId, accessToken)) {
    return { allowed: true }
  }

  const identity = await getAuthIdentity(ctx)
  if (!identity) {
    return {
      allowed: false,
      reason:
        access === ROOM_ACCESS_MODES.MEMBERS
          ? "You must be signed in to access this workspace room"
          : access === ROOM_ACCESS_MODES.PASSWORD
            ? "Join this room with its password to access it"
            : "Join this room to access it",
    }
  }

  if (!(room as any).orgId && access !== ROOM_ACCESS_MODES.PASSWORD) {
    return { allowed: true }
  }

  if (await getWorkspaceMembership(ctx, (room as any).orgId, identity.subject)) {
    return { allowed: true }
  }

  if (access === ROOM_ACCESS_MODES.MEMBERS) {
    return { allowed: false, reason: "You do not have access to this workspace" }
  }

  if (await getRoomMembership(ctx, roomId, identity.subject)) {
    return { allowed: true }
  }

  return {
    allowed: false,
    reason:
      access === ROOM_ACCESS_MODES.PASSWORD
        ? "Join this room with its password to access it"
        : "Join this room to access it",
  }
}

export const requireRoomResourceAccess = async (
  ctx: any,
  roomId: any,
  accessToken?: string,
) => {
  const decision = await canAccessRoomResource(ctx, roomId, accessToken)
  if (decision.allowed === false) {
    throw new ConvexError({ code: ROOM_ACCESS_REQUIRED, message: decision.reason })
  }
}

export const requireRoomManager = async (ctx: any, roomId: any) => {
  const room = await getRoomOrThrow(ctx, roomId)
  const identity = await getAuthIdentity(ctx)
  if (!identity && !(room as any).orgId && (room as any).access !== ROOM_ACCESS_MODES.PASSWORD) {
    return {
      room,
      externalId: null,
      workspaceMembership: null,
      roomMembership: null,
      isWorkspaceAdmin: false,
      isRoomManager: true,
    }
  }
  if (!identity) {
    throw new Error("You must be signed in to manage this room")
  }

  const externalId = identity.subject
  const workspaceMembership = await getWorkspaceMembership(ctx, (room as any).orgId, externalId)
  const roomMembership = await getRoomMembership(ctx, roomId, externalId)
  const isWorkspaceAdmin = isWorkspaceAdminRole((workspaceMembership as any)?.role)
  const isRoomManager = isRoomManagerRole((roomMembership as any)?.role)

  if (!isWorkspaceAdmin && !isRoomManager) {
    throw new Error("You are not allowed to manage this room")
  }

  return {
    room,
    externalId,
    workspaceMembership,
    roomMembership,
    isWorkspaceAdmin,
    isRoomManager,
  }
}

export const requireWorkspaceAdminForOrg = async (ctx: any, orgId: any, externalId: string) => {
  if (!orgId) {
    return null
  }

  const membership = await getWorkspaceMembership(ctx, orgId, externalId)
  if (!membership) {
    throw new Error("You are not a member of this workspace")
  }
  if (!isWorkspaceAdminRole((membership as any).role)) {
    throw new Error("Only workspace owners and admins can manage rooms")
  }
  return membership
}

/** Who is calling in this room: the signed-in user, or the guest the room's access grant was issued to. */
export const resolveParticipant = async (ctx: any, roomId: string, accessToken: string | undefined) => {
  const identity = await getAuthIdentity(ctx)
  if (identity) return identity.subject as string
  const grant = await findRoomAccessGrant(ctx, roomId, accessToken)
  return (grant?.identity as string | undefined) ?? null
}
