import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  findRoomAccessGrant,
  PRESENCE_STALE_AFTER_MS,
  requireRoomResourceAccess,
  ROOM_ACCESS_GRANT_TTL_MS,
} from './lib/roomAccess';
import { touchRoomSession } from './lib/sessions';

// SECURITY: A userId is only believed when a join grant or the verified auth
// identity vouches for it, so nobody can fake or delete someone else's presence.
const resolvePresenceUserId = async (ctx: any, args: { roomId: any; userId: string; accessToken?: string }, mismatchError: string) => {
  const grant = await findRoomAccessGrant(ctx, args.roomId, args.accessToken);
  if (grant?.identity === args.userId) return args.userId;

  const auth = (ctx as any).auth;
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null;
  if (!identity) throw new Error('A valid room session is required');
  if (identity.subject !== args.userId) throw new Error(mismatchError);
  return identity.subject as string;
};

export const setHandRaised = mutation({
  args: {
    roomId: v.id('rooms'),
    userId: v.string(),
    userName: v.string(),
    raised: v.boolean(),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken);
    const effectiveUserId = await resolvePresenceUserId(ctx, args, 'Can only update your own hand raise state');

    const existing = await ctx.db
      .query('roomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', args.roomId).eq('userId', effectiveUserId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        handRaised: args.raised,
        lastSeen: now,
        userName: args.userName,
      });
    } else {
      await ctx.db.insert('roomPresence', {
        roomId: args.roomId,
        userId: effectiveUserId,
        userName: args.userName,
        handRaised: args.raised,
        lastSeen: now,
      });
    }
  },
});

export const heartbeat = mutation({
  args: {
    roomId: v.id('rooms'),
    userId: v.string(),
    userName: v.string(),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken);
    const effectiveUserId = await resolvePresenceUserId(ctx, args, 'Can only update your own presence');

    const existing = await ctx.db
      .query('roomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', args.roomId).eq('userId', effectiveUserId))
      .first();

    const now = Date.now();

    // Meetings may outlast the grant TTL. Renew rarely: every patch re-runs the
    // room queries that read this grant.
    const grant = await findRoomAccessGrant(ctx, args.roomId, args.accessToken);
    if (grant && grant.expiresAt - now < ROOM_ACCESS_GRANT_TTL_MS / 2) {
      await ctx.db.patch(grant._id, { expiresAt: now + ROOM_ACCESS_GRANT_TTL_MS });
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: now,
        userName: args.userName,
      });
    } else {
      await ctx.db.insert('roomPresence', {
        roomId: args.roomId,
        userId: effectiveUserId,
        userName: args.userName,
        handRaised: false,
        lastSeen: now,
      });
    }

    // The heartbeat is the only thing that knows people are in the room, so it also keeps the session.
    await touchRoomSession(ctx, args.roomId, now);
  },
});

export const leave = mutation({
  args: { roomId: v.id('rooms'), userId: v.string(), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const effectiveUserId = await resolvePresenceUserId(ctx, args, 'Can only remove your own presence');
    const existing = await ctx.db
      .query('roomPresence')
      .withIndex('by_room_user', (q) => q.eq('roomId', args.roomId).eq('userId', effectiveUserId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const listForRoom = query({
  args: { roomId: v.id('rooms'), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken);
    const rows = await ctx.db
      .query('roomPresence')
      .withIndex('by_room', (q) => q.eq('roomId', args.roomId))
      .collect();

    const cutoff = Date.now() - PRESENCE_STALE_AFTER_MS;
    return rows
      .filter((r) => r.lastSeen > cutoff)
      .map((r) => ({
        userId: r.userId,
        userName: r.userName,
        handRaised: r.handRaised,
        lastSeen: r.lastSeen,
      }));
  },
});
