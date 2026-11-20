import { ConvexError, v } from "convex/values"
import { refuse } from "./lib/refusal"
import { action, internalMutation, mutation, query } from "./_generated/server"
import { internal } from "./_generated/api"
import { getCurrentMembership, ORG_ADMIN_ROLES, requireOrgAdmin } from "./orgMembers"
import { hashRoomAccessToken } from "./lib/roomAccess"
import { checkApiRateLimit } from "./lib/rateLimit"

const KEY_PREFIX = "tavio_"
const MAX_KEYS_PER_WORKSPACE = 20
// lastUsedAt is written at most once a minute, so busy keys do not rewrite their row on every request.
const LAST_USED_RESOLUTION_MS = 60 * 1000

export type ApiKey = {
  id: string
  name: string
  prefix: string
  createdAt: number
  lastUsedAt: number | null
}

const mapKey = (doc: any): ApiKey => ({
  id: doc._id,
  name: doc.name,
  prefix: doc.prefix,
  createdAt: doc.createdAt,
  lastUsedAt: doc.lastUsedAt ?? null,
})

/** The workspace's keys for its owners and admins; null for everyone else. */
export const list = query({
  args: {},
  handler: async (ctx): Promise<ApiKey[] | null> => {
    const membership = await getCurrentMembership(ctx)
    if (!membership || !ORG_ADMIN_ROLES.includes(membership.role)) return null
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_org", q => q.eq("orgId", membership.orgId))
      .collect()
    return keys.sort((a, b) => b.createdAt - a.createdAt).map(mapKey)
  },
})

/** Returns the key itself once; only its hash is stored. An action, because mutations have no secure randomness. */
export const create = action({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<{ key: string; apiKey: ApiKey }> => {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const key = KEY_PREFIX + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
    const apiKey: ApiKey = await ctx.runMutation(internal.apiKeys.insert, {
      name: args.name,
      prefix: key.slice(0, KEY_PREFIX.length + 6),
      tokenHash: await hashRoomAccessToken(key),
    })
    return { key, apiKey }
  },
})

export const insert = internalMutation({
  args: { name: v.string(), prefix: v.string(), tokenHash: v.string() },
  handler: async (ctx, args): Promise<ApiKey> => {
    const membership = await requireOrgAdmin(ctx)
    const name = args.name.trim()
    if (!name || name.length > 60) {
      throw new ConvexError("Give the key a name of up to 60 characters.")
    }
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_org", q => q.eq("orgId", membership.orgId))
      .collect()
    if (existing.length >= MAX_KEYS_PER_WORKSPACE) {
      throw new ConvexError(`A workspace can have up to ${MAX_KEYS_PER_WORKSPACE} API keys. Revoke one first.`)
    }
    const id = await ctx.db.insert("apiKeys", {
      orgId: membership.orgId,
      name,
      prefix: args.prefix,
      tokenHash: args.tokenHash,
      createdByUserId: membership.userId,
      createdAt: Date.now(),
    })
    return mapKey(await ctx.db.get(id))
  },
})

/** Deletes the key; requests with it fail from now on. */
export const revoke = mutation({
  args: { id: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const membership = await requireOrgAdmin(ctx)
    const key = await ctx.db.get(args.id)
    if (!key || key.orgId !== membership.orgId) {
      throw new ConvexError("API key not found.")
    }
    await ctx.db.delete(args.id)
  },
})

/** The workspace a REST API request acts for. Counts the request against the key's rate limit. */
export const authenticate = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_token_hash", q => q.eq("tokenHash", args.tokenHash))
      .first()
    if (!key) {
      throw refuse("unauthorized", "The API key is not valid.")
    }
    await checkApiRateLimit(ctx, key._id)
    const now = Date.now()
    if (!key.lastUsedAt || now - key.lastUsedAt >= LAST_USED_RESOLUTION_MS) {
      await ctx.db.patch(key._id, { lastUsedAt: now })
    }
    return { orgId: key.orgId }
  },
})
