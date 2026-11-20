import { query, mutation } from "./_generated/server"
import { ConvexError, v } from "convex/values"
import { sanitizeHtml } from "./lib/sanitization"
import { validateMeetingDoc } from "./lib/validation"
import { checkMeetingDocRateLimit } from "./lib/rateLimit"
import { requireRoomManager, requireRoomResourceAccess } from "./lib/roomAccess"
import { mergeAssistantBlocks } from "./lib/assistantEdits"

const DEFAULT_CONTENT = `
  <h2>Meeting Notes</h2>
  <p>Start typing your agenda, minutes, and action items here...</p>
`

const normalizeContent = (html: string) => html.replace(/\s+/g, " ").trim()

export const get = query({
  args: { roomId: v.string(), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const doc = await ctx.db
      .query("meetingDocs")
      .withIndex("by_room", q => q.eq("roomId", args.roomId))
      .first()
    if (!doc) {
      return { roomId: args.roomId, contentHtml: DEFAULT_CONTENT, locked: false, revision: null }
    }
    return { roomId: args.roomId, contentHtml: doc.contentHtml, locked: doc.locked, changedAt: doc.changedAt ?? null, revision: doc.revision ?? null }
  }
})

export const save = mutation({
  args: {
    roomId: v.string(),
    contentHtml: v.string(),
    accessToken: v.optional(v.string()),
    // The assistant's blocks this editor has shown. One it never showed cannot have been deleted in it.
    seenAssistantIds: v.optional(v.array(v.string())),
    edit: v.optional(v.object({
      base: v.union(v.string(), v.null()),
      revision: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    // Rate limiting (60 saves per minute)
    await checkMeetingDocRateLimit(ctx)

    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)

    // Validate document size
    validateMeetingDoc(args.contentHtml);

    const existing = await ctx.db
      .query("meetingDocs")
      .withIndex("by_room", q => q.eq("roomId", args.roomId))
      .first()
    if (existing?.locked) await requireRoomManager(ctx, args.roomId)
    if (args.edit && args.edit.base !== (existing?.revision ?? null)) throw new ConvexError("NOTES_CONFLICT")
    const revision = args.edit?.revision ?? crypto.randomUUID()

    const sanitizedHtml = await mergeAssistantBlocks(ctx, args.roomId, existing?.contentHtml ?? "", sanitizeHtml(args.contentHtml), args.seenAssistantIds);
    if (existing) {
      await ctx.db.patch(existing._id, { contentHtml: sanitizedHtml, revision, changedAt: Date.now() })
      return { roomId: args.roomId, contentHtml: sanitizedHtml, locked: existing.locked }
    }
    const id = await ctx.db.insert("meetingDocs", { roomId: args.roomId, contentHtml: sanitizedHtml, locked: false, revision, changedAt: Date.now() })
    const doc = await ctx.db.get(id)
    return { roomId: args.roomId, contentHtml: doc?.contentHtml ?? sanitizedHtml, locked: doc?.locked ?? false }
  }
})

export const setLocked = mutation({
  args: { roomId: v.string(), locked: v.boolean() },
  handler: async (ctx, args) => {
    await requireRoomManager(ctx, args.roomId)
    const existing = await ctx.db
      .query("meetingDocs")
      .withIndex("by_room", q => q.eq("roomId", args.roomId))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, { locked: args.locked })
      return { roomId: args.roomId, contentHtml: existing.contentHtml, locked: args.locked }
    }
    const id = await ctx.db.insert("meetingDocs", { roomId: args.roomId, contentHtml: DEFAULT_CONTENT, locked: args.locked })
    const doc = await ctx.db.get(id)
    return { roomId: args.roomId, contentHtml: doc?.contentHtml ?? DEFAULT_CONTENT, locked: doc?.locked ?? args.locked }
  }
})

export const listAvailabilityForRooms = query({
  args: { roomIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      return {}
    }

    const externalId = identity.subject
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q: any) => q.eq("userId", externalId))
      .collect()
    const orgIds = new Set(memberships.map((m: any) => m.orgId))

    const availability: Record<string, boolean> = {}
    const uniqueRoomIds = Array.from(new Set(args.roomIds))
    for (const roomId of uniqueRoomIds) {
      const room = await ctx.db.get(roomId as any)
      if (!room) {
        availability[roomId] = false
        continue
      }

      const canAccess =
        (room as any).access === "OPEN" ||
        ((room as any).orgId && orgIds.has((room as any).orgId))

      if (!canAccess) {
        availability[roomId] = false
        continue
      }

      const doc = await ctx.db
        .query("meetingDocs")
        .withIndex("by_room", q => q.eq("roomId", roomId))
        .first()

      availability[roomId] = !!doc && normalizeContent(doc.contentHtml) !== normalizeContent(DEFAULT_CONTENT)
    }

    return availability
  }
})
