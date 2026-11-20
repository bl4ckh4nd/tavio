import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { requireRoomResourceAccess, resolveParticipant } from "./lib/roomAccess"
import { checkChatRateLimit } from "./lib/rateLimit"

/** Comment pins: one thread per board element, with replies and a done tick. */
const MAX_TEXT = 2000
const MAX_NAME = 60
const MAX_REPLIES = 100

const room = { roomId: v.id("rooms"), accessToken: v.optional(v.string()) }

const participantIn = async (ctx: any, roomId: string, accessToken: string | undefined) => {
  await requireRoomResourceAccess(ctx, roomId, accessToken)
  const who = await resolveParticipant(ctx, roomId, accessToken)
  if (!who) throw new ConvexError("Join this room to comment")
  return who
}

/** What is on the board now; earlier boards' threads belong to the history, not to whoever is in the call. */
const wallIds = async (ctx: any, roomId: string) => {
  const wall = await ctx.db.query("whiteboardSnapshots").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).first()
  return new Set(((wall?.elements ?? []) as any[]).map((el) => el.id as string))
}

const threadsOf = async (ctx: any, roomId: string) =>
  await ctx.db.query("boardComments").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).collect()

export const list = query({
  args: room,
  handler: async (ctx, args) => {
    const me = await participantIn(ctx, args.roomId, args.accessToken)
    const onWall = await wallIds(ctx, args.roomId)
    return (await threadsOf(ctx, args.roomId)).filter((thread: any) => onWall.has(thread.elementId)).map((thread: any) => ({
      id: thread._id,
      elementId: thread.elementId as string,
      resolved: thread.resolved as boolean,
      replies: (thread.replies as any[]).map((r) => ({ name: r.name as string, text: r.text as string, at: r.at as number, mine: r.author === me })),
    }))
  },
})

export const add = mutation({
  args: { ...room, elementId: v.string(), name: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const author = await participantIn(ctx, args.roomId, args.accessToken)
    await checkChatRateLimit(ctx, author, args.roomId)
    const text = args.text.trim()
    if (!text) throw new ConvexError("A comment cannot be empty")
    if (text.length > MAX_TEXT) throw new ConvexError("This comment is too long")
    if (!(await wallIds(ctx, args.roomId)).has(args.elementId)) throw new ConvexError("This element is not on the board")
    const reply = { author, name: args.name.trim().slice(0, MAX_NAME) || "Guest", text, at: Date.now() }
    const thread = (await threadsOf(ctx, args.roomId)).find((t: any) => t.elementId === args.elementId)
    if (!thread) {
      await ctx.db.insert("boardComments", { roomId: args.roomId, elementId: args.elementId, resolved: false, replies: [reply] })
      return
    }
    if (thread.replies.length >= MAX_REPLIES) throw new ConvexError("This thread is full")
    await ctx.db.patch(thread._id, { resolved: false, replies: [...thread.replies, reply] })
  },
})

export const resolve = mutation({
  args: { ...room, threadId: v.id("boardComments"), resolved: v.boolean() },
  handler: async (ctx, args) => {
    await participantIn(ctx, args.roomId, args.accessToken)
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.roomId !== args.roomId) throw new ConvexError("Comment not found")
    await ctx.db.patch(thread._id, { resolved: args.resolved })
  },
})
