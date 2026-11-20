import { query } from "./_generated/server";

const mapRoom = (doc: any) => {
  const { _id, _creationTime, ...rest } = doc;
  return { id: _id, ...rest };
};

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const auth = (ctx as any).auth;
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null;
    if (!identity) {
      return null;
    }
    const externalId = identity.subject;

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q: any) => q.eq("userId", externalId))
      .first();
    if (!membership) {
      return null;
    }

    const orgId = membership.orgId;

    const roomsDocs = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
      .collect();
    const rooms = roomsDocs.map(mapRoom);
    const totalRooms = rooms.length;
    const activeRooms = rooms.filter((r: any) => (r.activeParticipants ?? 0) > 0).length;

    const recordings = await ctx.db
      .query("recordings")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
      .collect();

    const now = Date.now();
    let totalMs = 0;
    for (const rec of recordings) {
      if (rec.status === "completed" && rec.durationMs) {
        totalMs += rec.durationMs;
      } else if (rec.status === "recording") {
        totalMs += now - rec.startedAt;
      }
    }

    const totalMinutes = Math.round(totalMs / 60000);

    return {
      orgId,
      rooms: {
        total: totalRooms,
        active: activeRooms,
      },
      recordings: {
        total: recordings.length,
        totalMinutes,
      },
    };
  },
});

