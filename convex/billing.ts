import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRoomManager } from "./lib/roomAccess";

const PLANS = {
  free: {
    id: "free",
    name: "Free",
    maxRooms: 3,
    maxParticipantsPerMeeting: 6,
    recordingMinutesIncluded: 0,
  },
  pro: {
    id: "pro",
    name: "Pro",
    maxRooms: 20,
    maxParticipantsPerMeeting: 20,
    recordingMinutesIncluded: 1000,
  },
  business: {
    id: "business",
    name: "Business",
    maxRooms: 100,
    maxParticipantsPerMeeting: 50,
    recordingMinutesIncluded: 10000,
  },
} as const;

type PlanId = keyof typeof PLANS;

export const getForOrg = query({
  args: { roomId: v.optional(v.id("rooms")) },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth;
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null;
    if (!identity) return null;

    const orgId = args.roomId
      ? (await requireRoomManager(ctx, args.roomId)).room.orgId
      : (await ctx.db.query("orgMemberships").withIndex("by_user", q => q.eq("userId", identity.subject)).first())?.orgId;
    if (!orgId) return null;
    const now = Date.now();

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
      .first();

    const planId: PlanId = (sub?.planId as PlanId) || "free";
    const plan = PLANS[planId];

    const currentPeriodStart =
      sub?.currentPeriodStart ?? now - 30 * 24 * 60 * 60 * 1000;
    const currentPeriodEnd =
      sub?.currentPeriodEnd ?? now + 30 * 24 * 60 * 60 * 1000;

    // Derive usage from recordings within the current period.
    const recordings = await ctx.db
      .query("recordings")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
      .collect();

    let totalMs = 0;
    for (const rec of recordings) {
      if (rec.startedAt < currentPeriodStart || rec.startedAt > currentPeriodEnd) {
        continue;
      }
      if (rec.status === "completed" && rec.durationMs) {
        totalMs += rec.durationMs;
      } else if (rec.status === "recording") {
        totalMs += now - rec.startedAt;
      }
    }
    const recordingMinutesUsed = Math.round(totalMs / 60000);

    // Rooms count for convenience.
    const roomsDocs = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
      .collect();

    return {
      orgId,
      planId: plan.id,
      planName: plan.name,
      status: sub?.status ?? "active",
      currentPeriodStart,
      currentPeriodEnd,
      limits: {
        maxRooms: plan.maxRooms,
        maxParticipantsPerMeeting: plan.maxParticipantsPerMeeting,
        recordingMinutesIncluded: plan.recordingMinutesIncluded,
      },
      usage: {
        roomsCount: roomsDocs.length,
        recordingMinutesUsed,
      },
    };
  },
});

export const _setSubscriptionForOrg = internalMutation({
  args: {
    orgId: v.id("organizations"),
    planId: v.string(),
    status: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
      .first();

    const now = Date.now();
    const periodMs = 30 * 24 * 60 * 60 * 1000;

    if (existing) {
      await ctx.db.patch(existing._id, {
        planId: args.planId,
        status: args.status,
        stripeCustomerId: args.stripeCustomerId ?? existing.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId ?? existing.stripeSubscriptionId,
        currentPeriodStart: args.currentPeriodStart ?? existing.currentPeriodStart ?? now,
        currentPeriodEnd: args.currentPeriodEnd ?? existing.currentPeriodEnd ?? now + periodMs,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("subscriptions", {
      orgId: args.orgId,
      planId: args.planId,
      status: args.status,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      currentPeriodStart: args.currentPeriodStart ?? now,
      currentPeriodEnd: args.currentPeriodEnd ?? now + periodMs,
      recordingMinutesUsed: 0,
    });
    return id;
  },
});
