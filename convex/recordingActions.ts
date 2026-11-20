"use node";

import { action, internalAction } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  WebhookConfig,
  WebhookReceiver,
} from "livekit-server-sdk";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { roomServiceHost } from "./lib/envValidation";

const PLANS = {
  free: { recordingMinutesIncluded: 0 },
  pro: { recordingMinutesIncluded: 1000 },
  business: { recordingMinutesIncluded: 10000 },
} as const;

type PlanId = keyof typeof PLANS;

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const createEgressClient = () => {
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");
  const host = process.env.LIVEKIT_EGRESS_HOST?.replace(/^ws/i, "http") || roomServiceHost(process.env.LIVEKIT_HOST ?? "");
  if (!host) throw new Error("LIVEKIT_EGRESS_HOST, LIVEKIT_API_HOST or LIVEKIT_HOST is not set");

  return new EgressClient(host, apiKey, apiSecret);
};

const getStorageConfig = () => ({
  endpoint: requireEnv("R2_ENDPOINT"),
  accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
  secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
  bucket: requireEnv("R2_BUCKET"),
  region: process.env.R2_REGION || "auto",
});

const createS3Client = (config: ReturnType<typeof getStorageConfig>) =>
  new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

export const getSignedRecordingUrl = async (storagePath: string) => {
  const config = getStorageConfig();
  return await getSignedUrl(
    createS3Client(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: storagePath }),
    { expiresIn: 900 },
  );
};

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  speaker: number;
  text: string;
};

type DeepgramTranscription = {
  text: string;
  segments: TranscriptSegment[];
};

const parseDeepgramTranscription = (payload: any): DeepgramTranscription => {
  const utterances = Array.isArray(payload?.results?.utterances)
    ? payload.results.utterances
    : [];
  const segments = utterances.flatMap((utterance: any) => {
    const startMs = Number(utterance?.start) * 1000;
    const endMs = Number(utterance?.end) * 1000;
    const speaker = Number(utterance?.speaker);
    const text = typeof utterance?.transcript === "string"
      ? utterance.transcript.trim()
      : "";
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      !Number.isFinite(speaker) ||
      !text
    ) {
      return [];
    }
    return [{ startMs, endMs, speaker, text }];
  });
  const text = payload?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return {
    text: typeof text === "string" ? text.trim() : segments.map((segment: { text: string }) => segment.text).join(" "),
    segments,
  };
};

export const transcribeDeepgramWithSegments = async (
  mediaUrl: string,
  fetchImpl: typeof fetch = fetch,
) => {
  const apiKey = requireEnv("DEEPGRAM_API_KEY");
  // Without a language Deepgram assumes English and returns an empty transcript for German speech.
  const response = await fetchImpl(
    "https://api.deepgram.com/v1/listen?model=nova-3&diarize_model=latest&utterances=true&smart_format=true&detect_language=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: mediaUrl }),
    },
  );
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).trim().slice(0, 300);
    } catch {
      // Keep the provider status when the response body is unavailable.
    }
    throw new Error(`Deepgram transcription failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  return parseDeepgramTranscription(await response.json());
};

// Keep the original text-only helper for existing callers.
export const transcribeDeepgram = async (
  mediaUrl: string,
  fetchImpl: typeof fetch = fetch,
) => (await transcribeDeepgramWithSegments(mediaUrl, fetchImpl)).text;

const egressWebhookUrl = () => {
  const url = process.env.LIVEKIT_EGRESS_WEBHOOK_URL ||
    (process.env.CONVEX_SITE_URL ? `${process.env.CONVEX_SITE_URL}/livekit/egress` : "");
  if (!url) throw new Error("LIVEKIT_EGRESS_WEBHOOK_URL or CONVEX_SITE_URL is not set");
  return url;
};

const createFileOutput = (filepath: string) => {
  const config = getStorageConfig();
  return new EncodedFileOutput({
    filepath,
    fileType: EncodedFileType.MP4,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: config.accessKeyId,
        secret: config.secretAccessKey,
        region: config.region,
        endpoint: config.endpoint,
        bucket: config.bucket,
        forcePathStyle: true,
      }),
    },
  });
};

export const start = action({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<any> => {
    const info = await ctx.runQuery(api.recordings.infoForControl, { roomId: args.roomId });
    const { roomSlug, livekitRoomName, orgId, externalId } = info;

    if (orgId) {
      const sub = await ctx.runQuery(api.billing.getForOrg, { roomId: args.roomId });
      const planId: PlanId = (sub?.planId as PlanId) || "free";
      const plan = PLANS[planId];
      const used = sub?.usage?.recordingMinutesUsed ?? 0;
      if (plan.recordingMinutesIncluded === 0) {
        throw new ConvexError("Recording is only available on paid plans. Upgrade your workspace plan to enable recordings.");
      }
      if (used >= plan.recordingMinutesIncluded) {
        throw new ConvexError("You’ve used all recording minutes for this billing period. Upgrade your plan or wait until the next cycle.");
      }
    }

    const startedAt = Date.now();
    const safeOrgPart = orgId ? String(orgId) : "org";
    const filepath = `${safeOrgPart}/${roomSlug}-${startedAt}.mp4`;
    const { id, created } = await ctx.runMutation(internal.recordings._createRecordingReservation, {
      orgId: orgId ?? undefined,
      roomId: args.roomId,
      startedAt,
      startedByUserId: externalId,
      storagePath: filepath,
    });
    if (!created) {
      return await ctx.runQuery(api.recordings.getById, { id });
    }

    let egressInfo;
    try {
      const apiKey = requireEnv("LIVEKIT_API_KEY");
      egressInfo = await createEgressClient().startRoomCompositeEgress(
        livekitRoomName,
        createFileOutput(filepath),
        {
          layout: "grid",
          audioOnly: false,
          webhooks: [new WebhookConfig({ url: egressWebhookUrl(), signingKey: apiKey })],
        },
      );
    } catch (error) {
      await ctx.runMutation(internal.recordings._updateRecording, {
        id,
        status: "failed",
      });
      throw error;
    }

    await ctx.runMutation(internal.recordings._updateRecording, {
      id,
      egressId: egressInfo.egressId || undefined,
    });
    // The recording stays "starting" until the egress_started webhook arrives: the
    // egress needs several seconds to launch Chrome, and stopping it before that
    // aborts the recording ("Stop called before pipeline could start").
    return await ctx.runQuery(api.recordings.getById, { id });
  },
});

export const stop = action({
  args: { recordingId: v.id("recordings") },
  handler: async (ctx, args): Promise<any> => {
    const recording = await ctx.runQuery(api.recordings.getById, { id: args.recordingId });
    if (!recording) throw new Error("Recording not found");
    await ctx.runQuery(api.recordings.infoForControl, { roomId: recording.roomId });
    if (recording.status !== "recording") return recording;
    if (!recording.egressId) throw new Error("Recording has no LiveKit egress ID");

    // The end webhook reports the actual result after the file is finalized.
    await createEgressClient().stopEgress(recording.egressId);
    return await ctx.runQuery(api.recordings.getById, { id: args.recordingId });
  },
});

/** For the REST API, which has checked the workspace already. */
export const signedDownloadUrl = internalAction({
  args: { storagePath: v.string() },
  handler: async (_ctx, args): Promise<string> => await getSignedRecordingUrl(args.storagePath),
});

export const getDownloadUrl = action({
  args: { recordingId: v.id("recordings") },
  handler: async (ctx, args) => {
    const recording = await ctx.runQuery(api.recordings.getById, { id: args.recordingId }) as any;
    if (!recording?.storagePath) throw new Error("Recording file is not available");
    return await getSignedRecordingUrl(recording.storagePath);
  },
});

const toMilliseconds = (value: unknown) => {
  const number = Number(value || 0);
  if (!number) return undefined;
  // LiveKit protobuf timestamps and file durations are nanoseconds.
  return number / 1_000_000;
};

export const handleEgressWebhook = internalAction({
  args: { body: v.string(), authHeader: v.string() },
  handler: async (ctx, args) => {
    const receiver = new WebhookReceiver(requireEnv("LIVEKIT_API_KEY"), requireEnv("LIVEKIT_API_SECRET"));
    const event = await receiver.receive(args.body, args.authHeader);
    if (event.event === "egress_started" && event.egressInfo?.egressId) {
      const found = await ctx.runMutation(internal.recordings._recordEgressStarted, {
        egressId: event.egressInfo.egressId,
      });
      if (!found) {
        // The egress can report before the start action stored its ID; let LiveKit retry.
        throw new Error(`Recording reservation not found for egress ${event.egressInfo.egressId}`);
      }
      return { handled: true, transcribed: false };
    }
    if (event.event !== "egress_ended" || !event.egressInfo?.egressId) {
      return { handled: false };
    }

    const egressInfo = event.egressInfo as any;
    const failed = Number(egressInfo.status) >= 4;
    const stoppedAt = toMilliseconds(egressInfo.endedAt) || Date.now();
    const durationMs = toMilliseconds(egressInfo.fileResults?.[0]?.duration);
    const recording = await ctx.runMutation(internal.recordings._recordEgressEnded, {
      egressId: egressInfo.egressId,
      status: failed ? "failed" : "completed",
      stoppedAt,
      durationMs,
    });
    if (!recording) {
      // The egress can finish before the reservation mutation stores its ID.
      // A non-2xx response lets LiveKit retry the signed webhook.
      throw new Error(`Recording reservation not found for egress ${egressInfo.egressId}`);
    }
    if (failed || !recording.storagePath) {
      return { handled: true, transcribed: false };
    }

    const shouldTranscribe = await ctx.runMutation(internal.recordings._beginTranscription, {
      recordingId: recording.recordingId,
    });
    if (!shouldTranscribe) return { handled: true, transcribed: false };

    try {
      const mediaUrl = await getSignedRecordingUrl(recording.storagePath);
      const transcription = await transcribeDeepgramWithSegments(mediaUrl);
      await ctx.runMutation(internal.recordings._completeTranscription, {
        recordingId: recording.recordingId,
        text: transcription.text,
        segments: transcription.segments,
      });
      return { handled: true, transcribed: true };
    } catch (error: any) {
      await ctx.runMutation(internal.recordings._failTranscription, {
        recordingId: recording.recordingId,
        error: error?.message || "Transcription failed",
      });
      throw error;
    }
  },
});
