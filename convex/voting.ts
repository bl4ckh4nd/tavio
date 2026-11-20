import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { PRESENCE_STALE_AFTER_MS, requireRoomManager, requireRoomResourceAccess, resolveParticipant } from "./lib/roomAccess"

/** Dot voting on the board: everyone has three dots for the elements; the moderator shows the result. */
const DOTS = 3

const roundOf = async (ctx: any, roomId: string) =>
  await ctx.db.query("voteRounds").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).first()

const voterIn = async (ctx: any, roomId: string, accessToken: string | undefined) => {
  await requireRoomResourceAccess(ctx, roomId, accessToken)
  const voter = await resolveParticipant(ctx, roomId, accessToken)
  if (!voter) throw new ConvexError("Only people in the call can vote")
  return voter
}

const room = { roomId: v.id("rooms"), accessToken: v.optional(v.string()) }

export const state = query({
  args: room,
  handler: async (ctx, args) => {
    const voter = await voterIn(ctx, args.roomId, args.accessToken)
    const round = await roundOf(ctx, args.roomId)
    if (!round) return null
    const votes = round.votes as { voter: string; elementId: string }[]
    const seen = {
      revealed: round.revealed as boolean,
      dots: DOTS,
      mine: votes.filter((vote) => vote.voter === voter).map((vote) => vote.elementId),
      voters: new Set(votes.map((vote) => vote.voter)).size,
    }
    if (!round.revealed) return seen
    const counts = new Map<string, number>()
    for (const vote of votes) counts.set(vote.elementId, (counts.get(vote.elementId) ?? 0) + 1)
    const results = [...counts].map(([elementId, count]) => ({ elementId, votes: count })).sort((a, b) => b.votes - a.votes)
    return { ...seen, results }
  },
})

export const control = mutation({
  args: { ...room, action: v.union(v.literal("start"), v.literal("reveal"), v.literal("end")) },
  handler: async (ctx, args) => {
    await requireRoomManager(ctx, args.roomId)
    const round = await roundOf(ctx, args.roomId)
    if (args.action === "start") {
      if (round) await ctx.db.patch(round._id, { revealed: false, votes: [] })
      else await ctx.db.insert("voteRounds", { roomId: args.roomId, revealed: false, votes: [] })
    } else if (round) {
      if (args.action === "end") await ctx.db.delete(round._id)
      else await ctx.db.patch(round._id, { revealed: true })
    }
  },
})

const openRound = async (ctx: any, roomId: string) => {
  const round = await roundOf(ctx, roomId)
  if (!round) throw new ConvexError("There is no vote running")
  if (round.revealed) throw new ConvexError("The vote is closed")
  return round
}

/** Dots are for people in the call: a token fetched without joining brings no three more. */
const presentVoter = async (ctx: any, roomId: string, accessToken: string | undefined) => {
  const voter = await voterIn(ctx, roomId, accessToken)
  const here = await ctx.db.query("roomPresence").withIndex("by_room_user", (q: any) => q.eq("roomId", roomId).eq("userId", voter)).first()
  if (!here || here.lastSeen <= Date.now() - PRESENCE_STALE_AFTER_MS) throw new ConvexError("Only people in the call can vote")
  return voter
}

export const cast = mutation({
  args: { ...room, elementId: v.string() },
  handler: async (ctx, args) => {
    const voter = await presentVoter(ctx, args.roomId, args.accessToken)
    if (args.elementId.length > 64) throw new ConvexError("Unknown element")
    const round = await openRound(ctx, args.roomId)
    const votes = round.votes as { voter: string; elementId: string }[]
    if (votes.filter((vote) => vote.voter === voter).length >= DOTS) throw new ConvexError("You have used your three dots")
    await ctx.db.patch(round._id, { votes: [...votes, { voter, elementId: args.elementId }] })
  },
})

export const take = mutation({
  args: { ...room, elementId: v.string() },
  handler: async (ctx, args) => {
    const voter = await voterIn(ctx, args.roomId, args.accessToken)
    const round = await openRound(ctx, args.roomId)
    const votes = round.votes as { voter: string; elementId: string }[]
    const at = votes.findIndex((vote) => vote.voter === voter && vote.elementId === args.elementId)
    if (at >= 0) await ctx.db.patch(round._id, { votes: votes.filter((_, index) => index !== at) })
  },
})
