import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRoomManager, requireRoomResourceAccess } from "./lib/roomAccess";
import { livekitRoomNameFor } from "./lib/roomIdentity";

const mapRecording = (doc: any) => {
  const { _id, _creationTime, ...rest } = doc;
  return { id: _id, ...rest };
};

const ACTIVE_RECORDING_STATUSES = ["starting", "recording"];

export const currentForRoom = query({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken);
    const rows = await ctx.db
      .query("recordings")
      .withIndex("by_room", (q: any) => q.eq("roomId", args.roomId))
      .collect();
    const active = rows.find((r: any) => ACTIVE_RECORDING_STATUSES.includes(r.status));
    return active ? mapRecording(active) : null;
  },
});

export const listForOrg = query({
  args: {},
  handler: async (ctx) => {
    const auth = (ctx as any).auth;
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null;
    if (!identity) return [];
    const externalId = identity.subject;

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q: any) => q.eq("userId", externalId))
      .first();
    if (!membership) return [];

    const rows = await ctx.db
      .query("recordings")
      .withIndex("by_org", (q: any) => q.eq("orgId", membership.orgId))
      .collect();

    const transcripts = await ctx.db.query("transcripts").collect();
    const transcriptByRecording = new Map(
      transcripts.map((transcript: any) => [String(transcript.recordingId), transcript]),
    );

    return rows.map((row: any) => ({
      ...mapRecording(row),
      transcriptStatus: transcriptByRecording.get(String(row._id))?.status ?? null,
    }));
  },
});

export const getById = query({
  args: { id: v.id("recordings") },
  handler: async (ctx, args) => {
    const rec = await ctx.db.get(args.id);
    if (rec) {
      await requireRoomResourceAccess(ctx, (rec as any).roomId);
    }
    return rec ? mapRecording(rec) : null;
  },
});

export const transcriptForRecording = query({
  args: { recordingId: v.id("recordings") },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording) return null;
    await requireRoomResourceAccess(ctx, recording.roomId);
    return await ctx.db
      .query("transcripts")
      .withIndex("by_recording", (q: any) => q.eq("recordingId", args.recordingId))
      .first();
  },
});

export const latestTranscriptForRoom = query({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken);
    const recordings = await ctx.db
      .query("recordings")
      .withIndex("by_room", (q: any) => q.eq("roomId", args.roomId))
      .collect();
    recordings.sort(
      (a: any, b: any) =>
        b.startedAt - a.startedAt || b._creationTime - a._creationTime,
    );

    for (const recording of recordings) {
      const transcript = await ctx.db
        .query("transcripts")
        .withIndex("by_recording", (q: any) => q.eq("recordingId", recording._id))
        .first();
      if (transcript) return transcript;
    }
    return null;
  },
});

export const infoForControl = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth;
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null;
    if (!identity) {
      throw new Error("You must be signed in to manage recordings");
    }
    const { room, externalId } = await requireRoomManager(ctx, args.roomId);
    const orgId = (room as any).orgId;

    return {
      roomId: args.roomId,
      roomSlug: (room as any).slug as string,
      livekitRoomName: livekitRoomNameFor(room as any),
      orgId: orgId ?? null,
      externalId,
    };
  },
});

export const _insertRecording = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    roomId: v.id("rooms"),
    egressId: v.optional(v.string()),
    status: v.string(),
    startedAt: v.number(),
    startedByUserId: v.string(),
    storagePath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("recordings", args);
  },
});

export const _createRecordingReservation = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    roomId: v.id("rooms"),
    startedAt: v.number(),
    startedByUserId: v.string(),
    storagePath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("recordings")
      .withIndex("by_room", (q: any) => q.eq("roomId", args.roomId))
      .collect();
    const active = rows.find((r: any) => ACTIVE_RECORDING_STATUSES.includes(r.status));
    if (active) {
      return { id: active._id, created: false };
    }

    const id = await ctx.db.insert("recordings", {
      ...args,
      status: "starting",
    });
    return { id, created: true };
  },
});

export const _updateRecording = internalMutation({
  args: {
    id: v.id("recordings"),
    egressId: v.optional(v.string()),
    status: v.optional(v.string()),
    stoppedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});

export const _recordEgressStarted = internalMutation({
  args: { egressId: v.string() },
  handler: async (ctx, args) => {
    const recording = await ctx.db
      .query("recordings")
      .withIndex("by_egress", (q: any) => q.eq("egressId", args.egressId))
      .first();
    if (!recording) return null;
    // Never revive a recording that already ended (webhooks can arrive out of order).
    if (recording.status === "starting") {
      await ctx.db.patch(recording._id, { status: "recording" });
    }
    return recording._id;
  },
});

export const _recordEgressEnded = internalMutation({
  args: {
    egressId: v.string(),
    status: v.string(),
    stoppedAt: v.number(),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const recording = await ctx.db
      .query("recordings")
      .withIndex("by_egress", (q: any) => q.eq("egressId", args.egressId))
      .first();
    if (!recording) return null;

    const patch = {
      status: args.status,
      stoppedAt: args.stoppedAt,
      ...(args.durationMs === undefined ? {} : { durationMs: args.durationMs }),
    };
    await ctx.db.patch(recording._id, patch);
    return {
      recordingId: recording._id,
      storagePath: recording.storagePath ?? null,
      status: args.status,
    };
  },
});

export const _beginTranscription = internalMutation({
  args: { recordingId: v.id("recordings") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("transcripts")
      .withIndex("by_recording", (q: any) => q.eq("recordingId", args.recordingId))
      .first();
    if (existing && (existing.status === "processing" || existing.status === "completed")) {
      return false;
    }

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "processing",
        error: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("transcripts", {
        recordingId: args.recordingId,
        status: "processing",
        provider: "deepgram",
        createdAt: now,
        updatedAt: now,
      });
    }
    return true;
  },
});

export const _completeTranscription = internalMutation({
  args: {
    recordingId: v.id("recordings"),
    text: v.string(),
    segments: v.optional(
      v.array(
        v.object({
          startMs: v.number(),
          endMs: v.number(),
          speaker: v.number(),
          text: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const transcript = await ctx.db
      .query("transcripts")
      .withIndex("by_recording", (q: any) => q.eq("recordingId", args.recordingId))
      .first();
    if (!transcript) return;
    await ctx.db.patch(transcript._id, {
      status: "completed",
      text: args.text,
      error: undefined,
      updatedAt: Date.now(),
      ...(args.segments === undefined ? {} : { segments: args.segments }),
    });
  },
});

export const _failTranscription = internalMutation({
  args: {
    recordingId: v.id("recordings"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const transcript = await ctx.db
      .query("transcripts")
      .withIndex("by_recording", (q: any) => q.eq("recordingId", args.recordingId))
      .first();
    if (!transcript) return;
    await ctx.db.patch(transcript._id, {
      status: "failed",
      error: args.error.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});
