import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { requireRoomManager, requireRoomResourceAccess } from "./lib/roomAccess"

/**
 * One timer per room. It is kept as the moment it ends (or, paused, what is left), never ticked here:
 * every screen counts down from the same end time.
 */
const MINUTE = 60_000

const timerOf = async (ctx: any, roomId: string) =>
  await ctx.db.query("roomTimers").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).first()

export const get = query({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const timer = await timerOf(ctx, args.roomId)
    if (!timer) return null
    return timer.endsAt !== undefined ? { endsAt: timer.endsAt as number, totalMs: timer.totalMs as number } : { leftMs: timer.leftMs as number, totalMs: timer.totalMs as number }
  },
})

export const control = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.optional(v.string()),
    action: v.union(v.literal("start"), v.literal("add"), v.literal("pause"), v.literal("resume"), v.literal("stop")),
    minutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRoomManager(ctx, args.roomId)
    const now = Date.now()
    const timer = await timerOf(ctx, args.roomId)
    if (args.action === "start") {
      const minutes = args.minutes ?? 0
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new ConvexError("A timer runs for 1 to 60 minutes")
      const fresh = { endsAt: now + minutes * MINUTE, leftMs: undefined, totalMs: minutes * MINUTE }
      if (timer) await ctx.db.patch(timer._id, fresh)
      else await ctx.db.insert("roomTimers", { roomId: args.roomId, endsAt: fresh.endsAt, totalMs: fresh.totalMs })
      return
    }
    if (!timer) return
    if (args.action === "stop") await ctx.db.delete(timer._id)
    else if (args.action === "add") {
      await ctx.db.patch(timer._id, timer.endsAt !== undefined
        ? { endsAt: Math.max(timer.endsAt, now) + MINUTE, totalMs: timer.totalMs + MINUTE }
        : { leftMs: timer.leftMs + MINUTE, totalMs: timer.totalMs + MINUTE })
    } else if (args.action === "pause" && timer.endsAt !== undefined) {
      await ctx.db.patch(timer._id, { endsAt: undefined, leftMs: Math.max(0, timer.endsAt - now) })
    } else if (args.action === "resume" && timer.leftMs !== undefined) {
      await ctx.db.patch(timer._id, { endsAt: now + timer.leftMs, leftMs: undefined })
    }
  },
})
