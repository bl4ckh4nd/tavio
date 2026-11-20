// Convex action that requires Node runtime
"use node";
import { action } from "./_generated/server"
import { ConvexError, v } from "convex/values"
import { AccessToken } from "livekit-server-sdk"
import { api, internal } from "./_generated/api"
import * as bcrypt from "bcryptjs"
import { randomUUID } from "crypto"
import { requireEnvForLiveKit } from "./lib/envValidation"
import { checkTokenRateLimit } from "./lib/rateLimit"
import { toRoomIdentity } from "./lib/roomIdentity"
import { resolveBreakoutMode } from "./lib/breakouts"
import { isMeetingEndBlockActive, isRoomManagerRole, isWorkspaceAdminRole, issueRoomAccessToken } from "./lib/roomAccess"

/**
 * Mint a short-lived LiveKit access token for a room.
 * Expects LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_HOST in Convex env.
 */
export const issueToken = action({
  args: {
    roomSlug: v.string(),
    name: v.optional(v.string()),
    password: v.optional(v.string())
  },
  // Explicit return type to avoid implicit any cycles with generated types
  handler: async (ctx, args): Promise<{
    token: string
    url: string
    role: string
    identity: string
    roomId: string
    livekitRoomName: string
    sessionCredential: string
    roomAccessToken: string
    breakoutMode: "native" | "reconnect"
  }> => {
    const auth = (ctx as any).auth
    const authIdentity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    const isAuthenticated = !!authIdentity
    if (isAuthenticated) await checkTokenRateLimit(ctx, authIdentity.subject)

    // Generate identity server-side to prevent client-side spoofing
    const externalId = isAuthenticated
      ? authIdentity.subject
      : `guest-${randomUUID()}`

    // Only persist a user/org membership for authenticated users.
    const ensuredUser: any = isAuthenticated
      ? await ctx.runMutation(internal.users.ensureForIdentity, {
          externalId,
          name: args.name ?? (authIdentity?.name as string | undefined),
          avatarUrl: (authIdentity as any)?.pictureUrl ?? (authIdentity as any)?.imageUrl
        })
      : null

    const room = await ctx.runQuery(api.rooms.getBySlug, { slug: args.roomSlug })

    if (!room) {
      throw new ConvexError("Room not found")
    }
    const roomIdentity = toRoomIdentity(room)

    // Ensure the user belongs to the same workspace as the room (if any).
    let workspaceRole: string | undefined
    let isOutsideWorkspace = false
    if ((room as any).orgId) {
      if (isAuthenticated) {
        const orgMemberships = await ctx.runQuery(api.organizations.listForCurrentUser, {})
        const workspaceMembership = Array.isArray(orgMemberships)
          ? orgMemberships.find((m: any) => m.id === (room as any).orgId)
          : undefined
        workspaceRole = workspaceMembership?.role
        isOutsideWorkspace = !workspaceMembership
        // Outside the workspace, an account grants nothing extra: OPEN and
        // PASSWORD rooms treat it like an anonymous guest, MEMBERS rooms reject it.
        if (isOutsideWorkspace && room.access === "MEMBERS") {
          throw new Error("You do not have access to this workspace")
        }
      } else {
        // Anonymous users can join OPEN and PASSWORD rooms.
        // MEMBERS rooms require authentication.
        if (room.access === "MEMBERS") {
          throw new Error("You must be signed in to join this room")
        }
      }
    }

    // Everyone who joins as a guest here, signed in or not, shares the room's allowance; it also bounds password guesses.
    // Members-only rooms take no guests, so turning them away must not use it up.
    if (!workspaceRole && room.access !== "MEMBERS") await checkTokenRateLimit(ctx, `guests:${room.id}`)

    if (room.access === "PASSWORD") {
      if (!args.password) {
        throw new ConvexError("Password required")
      }
      // Validate password using bcrypt (via mutation)
      await ctx.runMutation(internal.rooms.validatePassword, {
        roomSlug: args.roomSlug,
        password: args.password
      })
    }

    let role: string = isOutsideWorkspace ? "Participant" : (ensuredUser as any)?.role ?? "Participant"

    // Look up any existing room membership once; reused below for authenticated users.
    let membership: any = null
    if (isAuthenticated) {
      membership = await ctx.runQuery(api.memberships.getForRoom, {
        roomId: room.id as any,
        userId: externalId
      })
    }

    if (room.access === "MEMBERS") {
      if (!isAuthenticated) {
        throw new Error("You must be signed in to join this room")
      }

      // Ensure the first member becomes host for this room (atomic version)
      await ctx.runMutation(internal.memberships.ensureHostForFirstMemberAtomic, {
        roomId: room.id as any,
        userId: externalId
      })

      // Re-fetch membership in case this was the first member.
      membership =
        membership ||
        (await ctx.runQuery(api.memberships.getForRoom, {
          roomId: room.id as any,
          userId: externalId
        }))

      if (!membership) {
        throw new Error("Membership required for this room")
      }
      role = membership.role || role || "Participant"
    } else if (room.access === "OPEN") {
      if (isAuthenticated && !isOutsideWorkspace) {
        // For open rooms, we don't require memberships for guests,
        // but we bootstrap the first authenticated joiner as Host so
        // there is a privileged user before anonymous guests can join.
        await ctx.runMutation(internal.memberships.ensureHostForFirstMemberAtomic, {
          roomId: room.id as any,
          userId: externalId
        })

        // Refresh membership for the current user after potential bootstrap.
        membership =
          membership ||
          (await ctx.runQuery(api.memberships.getForRoom, {
            roomId: room.id as any,
            userId: externalId
          }))

        if (isRoomManagerRole(membership?.role)) role = membership.role
        else if (isWorkspaceAdminRole(workspaceRole)) role = "Host"
      }
      const canStart = !isOutsideWorkspace && (isRoomManagerRole(membership?.role) || isWorkspaceAdminRole(workspaceRole))
      if (!canStart && ((room as any).activeHosts ?? 0) <= 0) {
        throw new ConvexError(
          "A host or member must be present to start this room. Please wait for a host."
        )
      }
    }

    // Room hosts and workspace owners/admins manage the room server-side (requireRoomManager), so give them host controls in every access mode.
    if (role !== "Host" && role !== "Admin") {
      if (membership?.role === "Host" || membership?.role === "Admin") {
        role = membership.role
      } else if (workspaceRole === "OWNER" || workspaceRole === "ADMIN") {
        role = "Host"
      }
    }

    if (role === "Host" || role === "Admin") {
      if (isMeetingEndBlockActive(room)) {
        await ctx.runMutation(internal.rooms.markMeetingReopened, { roomId: room.id as any })
      }
    } else if (isMeetingEndBlockActive(room)) {
      throw new ConvexError("This meeting has ended. A host can reopen the room.")
    }

    // Validate and get LiveKit environment variables
    const { apiKey, apiSecret, host: livekitHost } = requireEnvForLiveKit();

    const at = new AccessToken(apiKey, apiSecret, {
      identity: externalId,
      name: args.name,
      attributes: { role },
      ttl: 15 * 60 // SECURITY: 15 minutes (reduced from 1 hour for better security)
    })

    at.addGrant({
      roomJoin: true,
      room: roomIdentity.livekitRoomName
    })

    const token = await at.toJwt()
    // This credential is deliberately not a room-join token. It only authorizes
    // the server-side breakout actions and is bound to the parent room + identity.
    const sessionCredentialToken = new AccessToken(apiKey, apiSecret, {
      identity: externalId,
      ttl: 6 * 60 * 60,
      attributes: {
        breakoutCredential: "1",
        sessionCredential: "1",
        issuedAt: String(Date.now()),
        mainRoom: roomIdentity.slug,
        parentRoom: roomIdentity.slug,
        name: args.name ?? (authIdentity?.name as string | undefined) ?? externalId,
        role,
      },
    })
    const sessionCredential = await sessionCredentialToken.toJwt()
    return {
      token,
      url: livekitHost,
      role,
      identity: externalId,
      roomId: roomIdentity.roomId,
      livekitRoomName: roomIdentity.livekitRoomName,
      sessionCredential,
      roomAccessToken: await issueRoomAccessToken(ctx, room.id, externalId),
      breakoutMode: resolveBreakoutMode(livekitHost),
    }
  }
})
