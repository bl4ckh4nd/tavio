import { query, mutation, internalMutation } from "./_generated/server"
import { v } from "convex/values"
import { sanitizePlainText } from "./lib/sanitization"
import { validateChatMessage } from "./lib/validation"
import { checkChatRateLimit, checkChatUploadRateLimit } from "./lib/rateLimit"
import { findRoomAccessGrant, requireRoomResourceAccess, resolveParticipant } from "./lib/roomAccess"
import { visibleSince } from "./lib/sessions"
import { CHAT_ORPHAN_UPLOAD_MS, CHAT_UPLOAD_MAX_BYTES, isAllowedGifUrl, isReactionEmoji } from "./lib/chatMedia"

const MAX_REACTION_KINDS_PER_MESSAGE = 20

// SECURITY: The participant comes from the verified server identity, or for guests from
// the join grant, which names them. Never from the client.
const clampSize = (value: number) => Math.min(10_000, Math.max(1, Math.round(value) || 1))

const attachmentArg = v.optional(v.union(
  v.object({ kind: v.literal("image"), uploadId: v.id("chatUploads"), width: v.number(), height: v.number() }),
  v.object({ kind: v.literal("gif"), url: v.string(), width: v.number(), height: v.number(), title: v.optional(v.string()) })
))

export const list = query({
  args: { roomId: v.string(), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const viewerId = await resolveParticipant(ctx, args.roomId, args.accessToken)
    // Guests read the chat of the meeting they are in; what earlier sessions wrote is for the room's members.
    const since = await visibleSince(ctx, args.roomId)
    const rows = (await ctx.db
      .query("chatMessages")
      .withIndex("by_room", q => q.eq("roomId", args.roomId))
      .order("desc")
      .take(100)).filter(r => r.timestamp >= since);
    const reactionRows = (await Promise.all(rows.map(r => ctx.db
      .query("chatReactions")
      .withIndex("by_message", q => q.eq("messageId", r._id))
      .collect()))).flat();

    const reactionsByMessage = new Map<string, Array<{ emoji: string; count: number; mine: boolean }>>()
    for (const reaction of reactionRows) {
      const entries = reactionsByMessage.get(reaction.messageId) ?? []
      let entry = entries.find(e => e.emoji === reaction.emoji)
      if (!entry) {
        entry = { emoji: reaction.emoji, count: 0, mine: false }
        entries.push(entry)
      }
      entry.count += 1
      if (reaction.userId === viewerId) entry.mine = true
      reactionsByMessage.set(reaction.messageId, entries)
    }

    const messages = await Promise.all(rows.map(async r => {
      const attachment = r.attachment?.kind === "image"
        ? { kind: "image" as const, url: await ctx.storage.getUrl(r.attachment.storageId), width: r.attachment.width, height: r.attachment.height }
        : r.attachment
      return {
        id: r._id,
        roomId: r.roomId,
        userId: r.userId,
        userName: r.userName,
        text: r.text,
        timestamp: r.timestamp,
        attachment,
        reactions: reactionsByMessage.get(r._id) ?? [],
      }
    }))
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }
});

export const send = mutation({
  args: {
    roomId: v.string(),
    userName: v.string(),
    text: v.string(),
    accessToken: v.optional(v.string()),
    attachment: attachmentArg,
  },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const verifiedUserId = await resolveParticipant(ctx, args.roomId, args.accessToken)
    if (!verifiedUserId) throw new Error("Join this room to chat")

    // Rate limiting (30 messages per minute per participant)
    await checkChatRateLimit(ctx, verifiedUserId, args.roomId)

    // An image or GIF may come without words; anything else needs text.
    if (!args.attachment || args.text.trim().length > 0) validateChatMessage(args.text);

    let attachment: any = undefined
    let uploadId: any = null
    if (args.attachment?.kind === "image") {
      const upload = await ctx.db.get(args.attachment.uploadId)
      if (!upload || upload.roomId !== args.roomId || upload.uploaderId !== verifiedUserId || upload.messageId) {
        throw new Error("This image can't be sent. Upload it again.")
      }
      uploadId = upload._id
      attachment = { kind: "image", storageId: upload.storageId, width: clampSize(args.attachment.width), height: clampSize(args.attachment.height) }
    } else if (args.attachment?.kind === "gif") {
      if (!isAllowedGifUrl(args.attachment.url)) throw new Error("This GIF can't be sent.")
      attachment = {
        kind: "gif",
        url: args.attachment.url,
        width: clampSize(args.attachment.width),
        height: clampSize(args.attachment.height),
        ...(args.attachment.title ? { title: sanitizePlainText(args.attachment.title.slice(0, 200)) } : {}),
      }
    }

    // Sanitize text and username to prevent XSS (escape HTML entities)
    const sanitizedText = sanitizePlainText(args.text.trim() ? args.text : "");
    const sanitizedUserName = sanitizePlainText(args.userName);

    const room = await ctx.db.get(args.roomId as any)
    const messageId = await ctx.db.insert("chatMessages", {
      orgId: (room as any)?.orgId,
      roomId: args.roomId,
      userId: verifiedUserId,
      userName: sanitizedUserName,
      text: sanitizedText,
      timestamp: Date.now(),
      ...(attachment ? { attachment } : {}),
    });
    if (uploadId) await ctx.db.patch(uploadId, { messageId })
  }
});

export const toggleReaction = mutation({
  args: { roomId: v.string(), messageId: v.id("chatMessages"), emoji: v.string(), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const userId = await resolveParticipant(ctx, args.roomId, args.accessToken)
    if (!userId) throw new Error("Join this room to react")
    if (!isReactionEmoji(args.emoji)) throw new Error("A reaction must be an emoji")
    const message = await ctx.db.get(args.messageId)
    if (!message || message.roomId !== args.roomId) throw new Error("Message not found")
    await checkChatRateLimit(ctx, userId, args.roomId)

    const reactions = await ctx.db
      .query("chatReactions")
      .withIndex("by_message", q => q.eq("messageId", args.messageId))
      .collect()
    const own = reactions.find(r => r.userId === userId && r.emoji === args.emoji)
    if (own) {
      await ctx.db.delete(own._id)
      return
    }
    const kinds = new Set(reactions.map(r => r.emoji))
    if (!kinds.has(args.emoji) && kinds.size >= MAX_REACTION_KINDS_PER_MESSAGE) {
      throw new Error("This message has too many different reactions")
    }
    await ctx.db.insert("chatReactions", { roomId: args.roomId, messageId: args.messageId, userId, emoji: args.emoji })
  }
});

/** Called by the upload endpoint before it stores anything: checks the join grant, the size and the allowance. */
export const prepareUpload = internalMutation({
  args: { roomId: v.string(), accessToken: v.string(), size: v.number() },
  handler: async (ctx, args) => {
    const grant = await findRoomAccessGrant(ctx, args.roomId, args.accessToken)
    if (!grant) throw new Error("Join this room to share images")
    const uploaderId = grant.identity as string
    const isGuest = uploaderId.startsWith("guest-")
    const maxBytes = isGuest ? CHAT_UPLOAD_MAX_BYTES.guest : CHAT_UPLOAD_MAX_BYTES.member
    if (args.size > maxBytes) throw new Error(`Image too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB)`)
    await checkChatUploadRateLimit(ctx, isGuest ? `guests:${args.roomId}` : uploaderId)
    return { uploaderId }
  }
});

export const recordUpload = internalMutation({
  args: { roomId: v.string(), uploaderId: v.string(), storageId: v.id("_storage"), contentType: v.string(), size: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("chatUploads", { ...args, createdAt: Date.now() })
  }
});

/** Deletes uploads that never made it into a message. Images of sent messages and of whiteboards stay. */
export const cleanupOrphanUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - CHAT_ORPHAN_UPLOAD_MS
    const stale = await ctx.db
      .query("chatUploads")
      .withIndex("by_orphan", q => q.eq("messageId", undefined).eq("keptFor", undefined).lt("createdAt", cutoff))
      .take(200)
    for (const upload of stale) {
      await ctx.storage.delete(upload.storageId)
      await ctx.db.delete(upload._id)
    }
  }
});
