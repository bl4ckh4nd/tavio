import { internalMutation, query, mutation } from "./_generated/server"
import { v } from "convex/values"
import { ensureDefaultOrgForUser } from "./organizations"
import { authComponent } from "./auth"

/**
 * Ensures the current authenticated user has a record in our users table.
 * Should be called when user accesses protected areas (e.g., Admin dashboard).
 * Creates user and default org membership if not exists.
 */
export const ensureCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) return null

    const externalId = identity.subject

    // Get Better Auth user for email/name
    const authUser = await authComponent.getAuthUser(ctx)
    const name = authUser?.name ?? identity.name ?? "User"
    const avatarUrl = authUser?.image ?? (identity as any)?.pictureUrl

    const existing = await ctx.db
      .query("users")
      .withIndex("by_externalId", q => q.eq("externalId", externalId))
      .first()

    if (existing) {
      // Update name/avatar/email if changed
      const updates: Record<string, string | undefined> = {}
      if (name && name !== existing.name) updates.name = name
      if (avatarUrl && avatarUrl !== existing.avatarUrl) updates.avatarUrl = avatarUrl
      if (authUser?.email && authUser.email !== existing.email) updates.email = authUser.email

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existing._id, updates)
      }

      await ensureDefaultOrgForUser(ctx, externalId, name)
      const updated = await ctx.db.get(existing._id)
      if (!updated) return null
      const { _id, _creationTime, ...rest } = updated
      return { id: _id, ...rest }
    }

    // Create new user
    const id = await ctx.db.insert("users", {
      externalId,
      email: authUser?.email,
      name,
      avatarUrl,
      role: "Participant"
    })

    await ensureDefaultOrgForUser(ctx, externalId, name)

    const user = await ctx.db.get(id)
    if (!user) return null
    const { _id, _creationTime, ...rest } = user
    return { id: _id, ...rest }
  }
})

export const ensureForIdentity = internalMutation({
  args: {
    externalId: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_externalId", q => q.eq("externalId", args.externalId))
      .first()

    if (existing) {
      if (args.name || args.avatarUrl) {
        await ctx.db.patch(existing._id, {
          name: args.name ?? existing.name,
          avatarUrl: args.avatarUrl ?? existing.avatarUrl
        })
      }
      await ensureDefaultOrgForUser(ctx, args.externalId, args.name ?? existing.name)
      const { _id, _creationTime, ...rest } = existing
      return { id: _id, ...rest }
    }

    const id = await ctx.db.insert("users", {
      externalId: args.externalId,
      name: args.name ?? "Anonymous",
      avatarUrl: args.avatarUrl,
      role: "Participant"
    })
    const user = await ctx.db.get(id)
    await ensureDefaultOrgForUser(ctx, args.externalId, args.name)
    if (!user) return null
    const { _id, _creationTime, ...rest } = user
    return { id: _id, ...rest }
  }
})

export const me = query({
  args: {},
  handler: async (ctx) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) return null

    const externalId = identity.subject
    const user = await ctx.db
      .query("users")
      .withIndex("by_externalId", q => q.eq("externalId", externalId))
      .first()

    if (!user) return null

    const { _id, _creationTime, ...rest } = user
    return { id: _id, ...rest }
  }
})

export const updateMe = mutation({
  args: {
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in")
    }

    const externalId = identity.subject
    const existing = await ctx.db
      .query("users")
      .withIndex("by_externalId", q => q.eq("externalId", externalId))
      .first()

    if (!existing) {
      throw new Error("User record not found")
    }

    const updates: Record<string, string> = {}
    if (typeof args.name === "string") {
      updates.name = args.name.trim() || existing.name
    }
    if (typeof args.avatarUrl === "string") {
      updates.avatarUrl = args.avatarUrl.trim()
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(existing._id, updates)
    }

    const updated = await ctx.db.get(existing._id)
    if (!updated) return null
    const { _id, _creationTime, ...rest } = updated
    return { id: _id, ...rest }
  }
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in to view users")
    }

    const externalId = identity.subject
    const caller = await ctx.db
      .query("users")
      .withIndex("by_externalId", q => q.eq("externalId", externalId))
      .first()

    if (caller?.role !== "Admin") {
      throw new Error("Only admins can view user list")
    }

    const rows = await ctx.db.query("users").collect()
    return rows.map(u => {
      const { _id, _creationTime, ...rest } = u
      return { id: _id, ...rest }
    })
  }
})

export const invite = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal("Participant"), v.literal("Admin"), v.literal("Host")))
  },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in to invite users")
    }

    const caller = await ctx.db
      .query("users")
      .withIndex("by_externalId", q => q.eq("externalId", identity.subject))
      .first()

    if (caller?.role !== "Admin") {
      throw new Error("Only admins can invite users")
    }

    const externalId = args.email

    const existing = await ctx.db
      .query("users")
      .withIndex("by_externalId", q => q.eq("externalId", externalId))
      .first()

    const base = {
      externalId,
      name: args.name ?? args.email,
      role: args.role ?? "Participant",
      avatarUrl: existing?.avatarUrl
    }

    if (existing) {
      await ctx.db.patch(existing._id, base)
      const { _id, _creationTime, ...rest } = { ...existing, ...base }
      return { id: _id, ...rest }
    }

    const id = await ctx.db.insert("users", base)
    const user = await ctx.db.get(id)
    if (!user) return null
    const { _id, _creationTime, ...rest } = user
    return { id: _id, ...rest }
  }
})

export const updateRole = mutation({
  args: {
    id: v.id("users"),
    role: v.union(v.literal("Participant"), v.literal("Admin"), v.literal("Host"))
  },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in")
    }

    const caller = await ctx.db
      .query("users")
      .withIndex("by_externalId", q => q.eq("externalId", identity.subject))
      .first()

    if (caller?.role !== "Admin") {
      throw new Error("Only admins can update user roles")
    }

    const existing = await ctx.db.get(args.id)
    if (!existing) return null
    await ctx.db.patch(args.id, { role: args.role })
    const { _id, _creationTime, ...rest } = { ...existing, role: args.role }
    return { id: _id, ...rest }
  }
})

export const remove = mutation({
  args: {
    id: v.id("users")
  },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null
    if (!identity) {
      throw new Error("Must be signed in")
    }

    const caller = await ctx.db
      .query("users")
      .withIndex("by_externalId", q => q.eq("externalId", identity.subject))
      .first()

    if (caller?.role !== "Admin") {
      throw new Error("Only admins can delete users")
    }

    await ctx.db.delete(args.id)
  }
})
