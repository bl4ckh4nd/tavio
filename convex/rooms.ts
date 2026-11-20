import { ConvexError, v } from "convex/values"
import { internal } from "./_generated/api"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { ensureDefaultOrgForUser } from "./organizations"
import * as bcrypt from "bcryptjs"
import { normalizeWebsiteUrl, validateHexColor, validateSlug, validateUrl } from "./lib/validation"
import { checkRoomCreateRateLimit } from "./lib/rateLimit"
import { getRoomMembership, getWorkspaceMembership, isRoomManagerRole, isWorkspaceAdminRole, PRESENCE_STALE_AFTER_MS, requireRoomManager, requireRoomResourceAccess, requireWorkspaceAdminForOrg } from "./lib/roomAccess"
import type { Doc } from "./_generated/dataModel"
import { livekitRoomNameFor } from "./lib/roomIdentity"
import { deleteRoomHistory } from "./lib/sessions"
import { refuse } from "./lib/refusal"
import { RoomAccess, RoomType } from "../src/types"

const PLANS = {
  free: {
    maxRooms: 3
  },
  pro: {
    maxRooms: 20
  },
  business: {
    maxRooms: 100
  }
} as const

type PlanId = keyof typeof PLANS
type LogoSource = "manual_upload" | "manual_url" | "auto_discovered"
type LogoFetchStatus = "idle" | "pending" | "success" | "failed"
type RoomBrandingValue = {
  logoUrl?: string
  logoStorageId?: string
  logoSource?: LogoSource
  logoFetchStatus?: LogoFetchStatus
  logoFetchError?: string
  logoFetchedAt?: string
  partnerWebsiteUrl?: string
  primaryColor?: string
  backgroundImageUrl?: string
  backgroundStorageId?: string
  theme?: string
}
type RoomBrandingInput = Omit<RoomBrandingValue, "logoSource" | "logoFetchStatus"> & {
  logoSource?: string
  logoFetchStatus?: string
}

const LOGO_SOURCES: LogoSource[] = ["manual_upload", "manual_url", "auto_discovered"]
const LOGO_FETCH_STATUSES: LogoFetchStatus[] = ["idle", "pending", "success", "failed"]

const roomBrandingValidator = v.object({
  logoUrl: v.optional(v.string()),
  logoStorageId: v.optional(v.string()),
  logoSource: v.optional(v.string()),
  logoFetchStatus: v.optional(v.string()),
  logoFetchError: v.optional(v.string()),
  logoFetchedAt: v.optional(v.string()),
  partnerWebsiteUrl: v.optional(v.string()),
  primaryColor: v.optional(v.string()),
  backgroundImageUrl: v.optional(v.string()),
  backgroundStorageId: v.optional(v.string()),
  theme: v.optional(v.string())
})

const cleanOptionalString = (value: string | undefined) => {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const validateLogoSource = (value: string | undefined): LogoSource | undefined => {
  if (!value) {
    return undefined
  }
  if (!LOGO_SOURCES.includes(value as LogoSource)) {
    throw new Error("Logo source is invalid")
  }
  return value as LogoSource
}

const validateLogoFetchStatus = (value: string | undefined): LogoFetchStatus | undefined => {
  if (!value) {
    return undefined
  }
  if (!LOGO_FETCH_STATUSES.includes(value as LogoFetchStatus)) {
    throw new Error("Logo fetch status is invalid")
  }
  return value as LogoFetchStatus
}

const isBrandingEmpty = (branding: RoomBrandingValue) =>
  Object.values(branding).every(value => value === undefined)

const prepareBranding = (branding?: RoomBrandingInput): RoomBrandingValue | undefined => {
  if (!branding) {
    return undefined
  }

  const logoUrl = cleanOptionalString(branding.logoUrl)
  const logoStorageId = cleanOptionalString(branding.logoStorageId)
  const partnerWebsiteInput = cleanOptionalString(branding.partnerWebsiteUrl)
  const partnerWebsiteUrl = partnerWebsiteInput ? normalizeWebsiteUrl(partnerWebsiteInput) : undefined
  const primaryColor = cleanOptionalString(branding.primaryColor)
  const backgroundImageUrl = cleanOptionalString(branding.backgroundImageUrl)
  const backgroundStorageId = cleanOptionalString(branding.backgroundStorageId)
  const theme = cleanOptionalString(branding.theme)
  let logoSource = validateLogoSource(cleanOptionalString(branding.logoSource))
  let logoFetchStatus = validateLogoFetchStatus(cleanOptionalString(branding.logoFetchStatus))
  let logoFetchError = cleanOptionalString(branding.logoFetchError)
  let logoFetchedAt = cleanOptionalString(branding.logoFetchedAt)

  if (logoUrl) {
    validateUrl(logoUrl, "Logo URL")
    logoSource = logoSource ?? (logoStorageId ? "manual_upload" : "manual_url")
    logoFetchStatus = "success"
    logoFetchError = undefined
    logoFetchedAt = logoFetchedAt ?? new Date().toISOString()
  } else if (partnerWebsiteUrl) {
    logoFetchStatus = logoFetchStatus ?? "idle"
    if (logoFetchStatus !== "failed") {
      logoFetchError = undefined
    }
    if (logoFetchStatus !== "success") {
      logoFetchedAt = undefined
      logoSource = undefined
    }
  } else {
    logoSource = undefined
    logoFetchStatus = undefined
    logoFetchError = undefined
    logoFetchedAt = undefined
  }

  if (backgroundImageUrl) {
    validateUrl(backgroundImageUrl, "Background image URL")
  }
  if (primaryColor) {
    validateHexColor(primaryColor)
  }

  const nextBranding: RoomBrandingValue = {
    logoUrl,
    logoStorageId,
    logoSource,
    logoFetchStatus,
    logoFetchError,
    logoFetchedAt,
    partnerWebsiteUrl,
    primaryColor,
    backgroundImageUrl,
    backgroundStorageId,
    theme,
  }

  return isBrandingEmpty(nextBranding) ? undefined : nextBranding
}

const queueDiscoveryBranding = (branding: RoomBrandingValue | undefined) => {
  if (!branding?.partnerWebsiteUrl || branding.logoUrl) {
    return { branding, shouldQueue: false }
  }

  return {
    branding: {
      ...branding,
      logoFetchStatus: "pending" as const,
      logoFetchError: undefined,
    },
    shouldQueue: true,
  }
}

const ensureWithinRoomLimit = async (ctx: any, orgId: any) => {
  if (!orgId) {
    return
  }
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
    .first()

  const planId: PlanId = (sub?.planId as PlanId) || "free"
  const plan = PLANS[planId]

  const roomsForOrg = await ctx.db
    .query("rooms")
    .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
    .collect()

  if (roomsForOrg.length >= plan.maxRooms) {
    throw refuse(
      "plan_limit",
      "You’ve reached the room limit for your current plan. Upgrade your workspace plan to create more rooms."
    )
  }
}

const mapRoom = (doc: any) => {
  // SECURITY: Never expose passwordHash or password to client
  const { _id, _creationTime, passwordHash, password, ...rest } = doc
  return { id: _id, ...rest }
}

const deleteAccessGrants = async (ctx: any, roomId: any, shouldDelete: (grant: any) => boolean = () => true) => {
  const grants = await ctx.db
    .query("roomAccessGrants")
    .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
    .collect()
  await Promise.all(grants.filter(shouldDelete).map((grant: any) => ctx.db.delete(grant._id)))
}

const recentPresence = (presence: Doc<"roomPresence">[]) => {
  const cutoff = Date.now() - PRESENCE_STALE_AFTER_MS
  return presence.filter(row => row.lastSeen > cutoff)
}

/** People with a recent heartbeat in the room, read through the room's index. */
export const countPresent = async (ctx: any, roomId: any) => {
  const presence = await ctx.db
    .query("roomPresence")
    .withIndex("by_room", (q: any) => q.eq("roomId", roomId))
    .collect()
  return recentPresence(presence).length
}

const ROOM_ACCESS_VALUES: string[] = Object.values(RoomAccess)
const ROOM_TYPE_VALUES: string[] = Object.values(RoomType)

type NewRoom = {
  name: string
  slug: string
  type: string
  access: string
  password?: string
  activeParticipants?: number
  maxParticipants?: number
  locked?: boolean
  recording?: boolean
  branding?: RoomBrandingInput
}

/** Checks and stores a new room for a workspace. The caller has checked who may create it. */
export const insertRoom = async (ctx: any, orgId: any, args: NewRoom) => {
  await ensureWithinRoomLimit(ctx, orgId)

  try {
    validateSlug(args.slug)
  } catch (error: any) {
    throw refuse("invalid_request", error.message)
  }
  if (!args.name || args.name.trim().length === 0) {
    throw refuse("invalid_request", "Room name cannot be empty")
  }
  if (args.name.length > 100) {
    throw refuse("invalid_request", "Room name too long (max 100 characters)")
  }
  if (!ROOM_ACCESS_VALUES.includes(args.access)) {
    throw refuse("invalid_request", `Access must be one of ${ROOM_ACCESS_VALUES.join(", ")}`)
  }
  if (!ROOM_TYPE_VALUES.includes(args.type)) {
    throw refuse("invalid_request", `Type must be one of ${ROOM_TYPE_VALUES.join(", ")}`)
  }

  const existingRoom = await ctx.db
    .query("rooms")
    .withIndex("by_slug", (q: any) => q.eq("slug", args.slug))
    .first()
  if (existingRoom) {
    throw refuse("conflict", "Room URL already exists. Please choose a different URL.")
  }

  const { branding, shouldQueue } = queueDiscoveryBranding(prepareBranding(args.branding))

  const now = new Date().toISOString().split("T")[0]

  // Use synchronous bcrypt in mutations because async bcryptjs relies on setTimeout.
  let passwordHash: string | undefined = undefined
  if (args.password) {
    passwordHash = bcrypt.hashSync(args.password, 10)
  }
  if (args.access === "PASSWORD" && !passwordHash) {
    throw refuse("invalid_request", "A password is required for password-protected rooms")
  }

  const id = await ctx.db.insert("rooms", {
    orgId,
    name: args.name,
    slug: args.slug,
    type: args.type,
    access: args.access,
    passwordHash,
    activeParticipants: args.activeParticipants ?? 0,
    activeHosts: 0,
    maxParticipants: args.maxParticipants ?? 50,
    locked: args.locked ?? false,
    recording: args.recording ?? false,
    createdAt: now,
    branding
  })
  if (shouldQueue && branding?.partnerWebsiteUrl) {
    await ctx.scheduler.runAfter(0, internal.roomBrandingActions.discoverLogoForRoom, {
      roomId: id,
      websiteUrl: branding.partnerWebsiteUrl,
    })
  }
  return await ctx.db.get(id)
}

/** Deletes a room with its access grants and history. The caller has checked who may delete it. */
export const deleteRoom = async (ctx: any, roomId: any) => {
  await deleteAccessGrants(ctx, roomId)
  await deleteRoomHistory(ctx, roomId)
  await ctx.db.delete(roomId)
}

export const isSlugAvailable = query({
  args: {
    slug: v.string(),
    excludeRoomId: v.optional(v.id("rooms")),
  },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in to check room slug availability")
    }

    const slug = args.slug.trim().toLowerCase()
    if (!slug) return true

    const existingRoom = await ctx.db
      .query("rooms")
      .withIndex("by_slug", q => q.eq("slug", slug))
      .first()

    return !existingRoom || existingRoom._id === args.excludeRoomId
  },
})

export const list = query({
  args: {
    filter: v.optional(
      v.object({
        access: v.optional(v.string())
      })
    )
  },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null

    let docs

    if (identity) {
      const externalId = identity.subject
      const memberships = await ctx.db
        .query("orgMemberships")
        .withIndex("by_user", q => q.eq("userId", externalId))
        .collect()

      const orgId = memberships[0]?.orgId
      if (orgId) {
        docs = await ctx.db
          .query("rooms")
          .withIndex("by_org", q => q.eq("orgId", orgId as any))
          .collect()
      } else {
        // Authenticated but no org membership — only show OPEN rooms
        docs = await ctx.db.query("rooms").collect()
        docs = docs.filter(r => r.access === "OPEN")
      }
    } else {
      // SECURITY: Anonymous users should only see OPEN rooms for privacy
      docs = await ctx.db.query("rooms").collect()
      docs = docs.filter(r => r.access === "OPEN")
    }
    const filtered = args.filter?.access
      ? docs.filter(r => r.access === args.filter?.access)
      : docs
    // Derive the displayed count from heartbeats so anonymous guests and missed
    // leave events cannot leave the admin/lobby count permanently stale. Query
    // each visible room through its index; never scan the whole presence table.
    return await Promise.all(filtered.map(async (room) => ({
      ...mapRoom(room),
      activeParticipants: await countPresent(ctx, room._id),
    })))
  }
})

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_slug", q => q.eq("slug", args.slug))
      .first()
    if (!room) return null

    // MEMBERS-only rooms must not be visible to unauthenticated users
    if ((room as any).access === "MEMBERS") {
      const auth = (ctx as any).auth
      const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
      if (!identity) return null
      // Require org membership when the room is org-scoped
      if ((room as any).orgId) {
        const memberships = await ctx.db
          .query("orgMemberships")
          .withIndex("by_user", (q: any) => q.eq("userId", identity.subject))
          .collect()
        if (!memberships.some((m: any) => m.orgId === (room as any).orgId)) {
          return null
        }
      }
    }

    const presence = await ctx.db
      .query("roomPresence")
      .withIndex("by_room", (q: any) => q.eq("roomId", room._id))
      .collect()
    const present = recentPresence(presence)
    const result = { ...mapRoom(room), activeParticipants: present.length }
    if (room.access !== "OPEN") return result

    const hosts = await Promise.all(present.map(async ({ userId }) => {
      // Like livekit.issueToken: outside the room's workspace, a room role grants nothing.
      const workspace = await getWorkspaceMembership(ctx, room.orgId, userId)
      if (room.orgId && !workspace) return false
      if (isWorkspaceAdminRole(workspace?.role)) return true
      const membership = await getRoomMembership(ctx, room._id, userId)
      return isRoomManagerRole(membership?.role)
    }))
    return { ...result, activeHosts: hosts.filter(Boolean).length }
  }
})

// Handoff redemption already carries a server-created room id. Keep this
// lookup private so a target device cannot use room visibility rules to make
// a valid MEMBERS handoff look missing.
export const getForDeviceHandoff = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId)
    return room ? mapRoom(room) : null
  },
})

/**
 * Everything meetingActions.endForAll must close. Breakout participants sit in
 * child LiveKit rooms, so closing only the parent would leave them connected.
 */
export const getMeetingEndTargets = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("You must be signed in to end this meeting")
    const { room } = await requireRoomManager(ctx, args.roomId)
    const session = await ctx.db
      .query("breakoutSessions")
      .withIndex("by_parent_status", q => q.eq("parentRoomId", args.roomId).eq("status", "active"))
      .first()
    return {
      livekitRoomNames: [
        ...(session?.rooms ?? []).map((entry: any) => entry.livekitRoomName),
        livekitRoomNameFor(room as any),
      ],
    }
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    type: v.string(),
    access: v.string(),
    password: v.optional(v.string()),
    activeParticipants: v.optional(v.number()),
    maxParticipants: v.optional(v.number()),
    locked: v.optional(v.boolean()),
    recording: v.optional(v.boolean()),
    branding: v.optional(roomBrandingValidator)
  },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in to create rooms")
    }

    // Rate limiting (5 rooms per hour)
    await checkRoomCreateRateLimit(ctx)

    const externalId = identity.subject
    const org = await ensureDefaultOrgForUser(ctx, externalId, identity.name as string | undefined)

    await requireWorkspaceAdminForOrg(ctx, org?.id, externalId)

    const room = await insertRoom(ctx, org?.id, args)
    return room ? mapRoom(room) : undefined
  }
})

export const update = mutation({
  args: {
    id: v.id("rooms"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    type: v.optional(v.string()),
    access: v.optional(v.string()),
    password: v.optional(v.string()),
    activeParticipants: v.optional(v.number()),
    activeHosts: v.optional(v.number()),
    maxParticipants: v.optional(v.number()),
    locked: v.optional(v.boolean()),
    recording: v.optional(v.boolean()),
    branding: v.optional(roomBrandingValidator)
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing) return undefined

    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in to update rooms")
    }
    const externalId = identity.subject
    await requireWorkspaceAdminForOrg(ctx, (existing as any).orgId, externalId)

    // Validate slug if being updated
    if (args.slug) {
      validateSlug(args.slug)

      // Check slug uniqueness (must be different from other rooms)
      const existingWithSlug = await ctx.db
        .query("rooms")
        .withIndex("by_slug", q => q.eq("slug", args.slug as string))
        .first()
      if (existingWithSlug && existingWithSlug._id !== args.id) {
        throw new Error("Room URL already exists. Please choose a different URL.")
      }
    }

    // Validate name if being updated
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) {
        throw new Error("Room name cannot be empty")
      }
      if (args.name.length > 100) {
        throw new Error("Room name too long (max 100 characters)")
      }
    }

    const currentBranding = prepareBranding((existing as any).branding)
    const nextBranding = args.branding !== undefined ? prepareBranding(args.branding) : currentBranding
    const shouldQueueDiscovery =
      !!nextBranding?.partnerWebsiteUrl &&
      !nextBranding.logoUrl &&
      nextBranding.partnerWebsiteUrl !== currentBranding?.partnerWebsiteUrl
    const brandingToPersist = shouldQueueDiscovery
      ? {
          ...nextBranding,
          logoFetchStatus: "pending" as const,
          logoFetchError: undefined,
        }
      : nextBranding

    // Use synchronous bcrypt in mutations because async bcryptjs relies on setTimeout.
    let passwordHash: string | undefined = (existing as any).passwordHash
    if (args.password) {
      passwordHash = bcrypt.hashSync(args.password, 10)
    }
    if ((args.access ?? existing.access) === "PASSWORD" && !passwordHash) {
      throw new ConvexError("A password is required for password-protected rooms")
    }

    // Whoever joined under the old rules has to pass the new gate.
    if (args.password || (args.access === "PASSWORD" && existing.access !== "PASSWORD")) {
      await deleteAccessGrants(ctx, args.id)
    }

    await ctx.db.patch(args.id, {
      name: args.name ?? existing.name,
      slug: args.slug ?? existing.slug,
      type: args.type ?? existing.type,
      access: args.access ?? existing.access,
      passwordHash,
      activeParticipants: args.activeParticipants ?? existing.activeParticipants,
      activeHosts: args.activeHosts ?? (existing as any).activeHosts,
      maxParticipants: args.maxParticipants ?? existing.maxParticipants,
      locked: args.locked ?? existing.locked,
      recording: args.recording ?? existing.recording,
      branding: brandingToPersist
    })

    if (shouldQueueDiscovery && brandingToPersist?.partnerWebsiteUrl) {
      await ctx.scheduler.runAfter(0, internal.roomBrandingActions.discoverLogoForRoom, {
        roomId: args.id,
        websiteUrl: brandingToPersist.partnerWebsiteUrl,
      })
    }

    const updated = await ctx.db.get(args.id)
    return updated ? mapRoom(updated) : undefined
  }
})

export const requestLogoDiscovery = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.roomId)
    if (!existing) {
      throw new Error("Room not found")
    }

    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in to update rooms")
    }

    const externalId = identity.subject
    await requireWorkspaceAdminForOrg(ctx, (existing as any).orgId, externalId)

    const branding = prepareBranding((existing as any).branding)
    if (!branding?.partnerWebsiteUrl) {
      throw new Error("Add a partner website before starting automatic logo discovery")
    }

    const pendingBranding: RoomBrandingValue = {
      ...branding,
      logoFetchStatus: "pending",
      logoFetchError: undefined,
    }

    await ctx.db.patch(args.roomId, {
      branding: pendingBranding,
    })

    await ctx.scheduler.runAfter(0, internal.roomBrandingActions.discoverLogoForRoom, {
      roomId: args.roomId,
      websiteUrl: branding.partnerWebsiteUrl,
    })

    return { queued: true }
  }
})

export const remove = mutation({
  args: { id: v.id("rooms") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id)
    if (!existing) return

    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in to delete rooms")
    }
    const externalId = identity.subject
    await requireWorkspaceAdminForOrg(ctx, (existing as any).orgId, externalId)

    await deleteRoom(ctx, args.id)
  }
})

export const updatePresence = mutation({
  args: {
    roomId: v.id("rooms"),
    deltaParticipants: v.number(),
    deltaHosts: v.number(),
    accessToken: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be authenticated to update presence")
    }

    const room = await ctx.db.get(args.roomId)
    if (!room) return

    // activeHosts is what lets guests into OPEN rooms, so only managers may move it.
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    if (args.deltaHosts !== 0) {
      await requireRoomManager(ctx, args.roomId)
    }
    if (Math.abs(args.deltaParticipants) > 1 || Math.abs(args.deltaHosts) > 1) {
      throw new Error("Presence can only change by one participant at a time")
    }

    const currentParticipants = (room as any).activeParticipants ?? 0
    const currentHosts = (room as any).activeHosts ?? 0

    await ctx.db.patch(args.roomId, {
      activeParticipants: Math.max(0, currentParticipants + args.deltaParticipants),
      activeHosts: Math.max(0, currentHosts + args.deltaHosts)
    })
  }
})

export const getLogoDiscoveryContext = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId)
    if (!room) {
      return null
    }

    return {
      id: room._id,
      branding: (room as any).branding as RoomBrandingValue | undefined,
    }
  }
})

export const applyLogoDiscoverySuccess = internalMutation({
  args: {
    roomId: v.id("rooms"),
    websiteUrl: v.string(),
    logoUrl: v.string(),
    logoStorageId: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId)
    if (!room) {
      return null
    }

    const currentBranding = prepareBranding((room as any).branding)
    if (currentBranding?.partnerWebsiteUrl !== args.websiteUrl) {
      return null
    }

    const nextBranding = prepareBranding({
      ...currentBranding,
      logoUrl: args.logoUrl,
      logoStorageId: args.logoStorageId,
      logoSource: "auto_discovered",
      logoFetchStatus: "success",
      logoFetchError: undefined,
      logoFetchedAt: new Date().toISOString(),
    })

    await ctx.db.patch(args.roomId, {
      branding: nextBranding,
    })

    return true
  }
})

export const applyLogoDiscoveryFailure = internalMutation({
  args: {
    roomId: v.id("rooms"),
    websiteUrl: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId)
    if (!room) {
      return null
    }

    const currentBranding = prepareBranding((room as any).branding)
    if (currentBranding?.partnerWebsiteUrl !== args.websiteUrl) {
      return null
    }

    const nextBranding = prepareBranding({
      ...currentBranding,
      logoFetchStatus: "failed",
      logoFetchError: args.error.trim().slice(0, 240),
      logoFetchedAt: undefined,
    })

    await ctx.db.patch(args.roomId, {
      branding: nextBranding,
    })

    return true
  }
})

export const createAccessGrant = internalMutation({
  args: {
    roomId: v.id("rooms"),
    identity: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    await deleteAccessGrants(ctx, args.roomId, grant => grant.expiresAt <= now)
    await ctx.db.insert("roomAccessGrants", args)
  },
})

export const revokeAccessGrants = internalMutation({
  args: { roomId: v.id("rooms"), issuedBefore: v.number() },
  handler: async (ctx, args) => {
    await deleteAccessGrants(ctx, args.roomId, grant => grant._creationTime < args.issuedBefore)
  },
})

export const markMeetingEnded = internalMutation({
  args: { roomId: v.id("rooms"), endedAt: v.number() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId)
    await ctx.db.patch(args.roomId, {
      meetingEndedAt: args.endedAt,
      meetingGeneration: ((room as any)?.meetingGeneration ?? 0) + 1,
    })
  },
})

export const markMeetingReopened = internalMutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.roomId, { meetingReopenedAt: Date.now() })
  },
})

/**
 * Internal mutation to validate room password using bcrypt
 * Used by livekit.ts action for secure password verification
 */
export const validatePassword = internalMutation({
  args: {
    roomSlug: v.string(),
    password: v.string()
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_slug", q => q.eq("slug", args.roomSlug))
      .first()

    if (!room) {
      throw new ConvexError("Room not found")
    }

    const roomData = room as any

    // If room doesn't require password, allow access
    if (roomData.access !== "PASSWORD") {
      return true
    }

    // If password required but not provided, deny
    if (!args.password || !roomData.passwordHash) {
      throw new ConvexError("Invalid room password")
    }

    // Use synchronous bcrypt in mutations because async bcryptjs relies on setTimeout.
    const isValid = bcrypt.compareSync(args.password, roomData.passwordHash)
    if (!isValid) {
      throw new ConvexError("Invalid room password")
    }

    return true
  }
})

/** Whether the caller may moderate this room (timer, voting): the same rule the server applies when they try. */
export const canManage = query({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    try {
      await requireRoomManager(ctx, args.roomId)
      return true
    } catch {
      return false
    }
  },
})
