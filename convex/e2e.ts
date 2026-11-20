import * as bcrypt from "bcryptjs"
import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { SESSION_IDLE_CLOSE_MS, finalizeSession } from "./lib/sessions"

/** The open room the landing page's product shots are taken in. */
export const seedShotRoom = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("rooms")
      .withIndex("by_slug", q => q.eq("slug", "design-sync"))
      .first()
    if (existing) throw new Error("design-sync already exists: start from an empty stack")

    return ctx.db.insert("rooms", {
      name: "Design sync",
      slug: "design-sync",
      type: "WORKSPACE",
      access: "OPEN",
      activeParticipants: 0,
      activeHosts: 0,
      maxParticipants: 50,
      locked: false,
      recording: false,
      createdAt: new Date().toISOString().split("T")[0],
    })
  },
})

/** Egress does not run locally, so the end-of-call shot gets its recording from here. */
export const seedShotRecording = internalMutation({
  args: {},
  handler: async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_slug", q => q.eq("slug", "design-sync"))
      .first()
    if (!room) throw new Error("design-sync does not exist")

    return ctx.db.insert("recordings", {
      roomId: room._id,
      status: "recording",
      startedAt: Date.now(),
      startedByUserId: "shots",
    })
  },
})

/** Seed a room for local end-to-end tests: by default the password-protected `meeting`; an open one has no password. */
export const seedRoom = internalMutation({
  args: {
    slug: v.optional(v.string()),
    name: v.optional(v.string()),
    password: v.optional(v.string()),
    access: v.optional(v.union(v.literal("PASSWORD"), v.literal("OPEN"))),
  },
  handler: async (ctx, args) => {
    const slug = args.slug ?? "meeting"
    const existing = await ctx.db
      .query("rooms")
      .withIndex("by_slug", q => q.eq("slug", slug))
      .first()

    if (existing) {
      return existing._id
    }

    const now = new Date().toISOString().split("T")[0]
    const id = await ctx.db.insert("rooms", {
      name: args.name ?? "Meeting",
      slug,
      type: "WORKSPACE",
      access: args.access ?? "PASSWORD",
      ...(args.access === "OPEN" ? {} : { passwordHash: bcrypt.hashSync(args.password ?? "123456", 10) }),
      activeParticipants: 0,
      activeHosts: 0,
      maxParticipants: 50,
      locked: false,
      recording: false,
      createdAt: now,
    })

    return id
  },
})

/**
 * A session closes once its room stayed empty for ten minutes, and tests cannot wait that long.
 * This closes every open session as if those ten minutes had just passed.
 */
export const closeOpenSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const open = await ctx.db
      .query("roomSessions")
      .withIndex("by_status_active", q => q.eq("status", "open"))
      .collect()
    const lastActiveAt = Date.now() - SESSION_IDLE_CLOSE_MS - 1000
    for (const session of open) {
      const startedAt = Math.min(session.startedAt, lastActiveAt - 60 * 1000)
      await ctx.db.patch(session._id, { startedAt, lastActiveAt })
      await finalizeSession(ctx, { ...session, startedAt, lastActiveAt })
    }
    return open.length
  },
})
