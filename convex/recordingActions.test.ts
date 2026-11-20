import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { receiveWebhook, signedUrl, startEgress, stopEgress } = vi.hoisted(() => ({
  receiveWebhook: vi.fn(),
  startEgress: vi.fn(async () => ({ egressId: "egress-1" })),
  stopEgress: vi.fn(),
  signedUrl: vi.fn(async () => "https://r2.example/signed"),
}));

vi.mock("livekit-server-sdk", () => ({
  EgressClient: class {
    startRoomCompositeEgress = startEgress;
    stopEgress = stopEgress;
  },
  EncodedFileOutput: class {},
  EncodedFileType: { MP4: 0 },
  S3Upload: class {},
  WebhookConfig: class {},
  WebhookReceiver: class {
    receive = receiveWebhook;
  },
}));
vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {},
  S3Client: class {},
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: signedUrl }));

import {
  handleEgressWebhook,
  start,
  stop,
  transcribeDeepgram,
  transcribeDeepgramWithSegments,
} from "./recordingActions";

describe("recording webhook and transcription seams", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEEPGRAM_API_KEY = "deepgram-test-key";
    process.env.LIVEKIT_HOST = "ws://localhost:7880";
    process.env.LIVEKIT_EGRESS_WEBHOOK_URL = "https://example.test/livekit/egress";
    process.env.LIVEKIT_API_KEY = "livekit-test-key";
    process.env.LIVEKIT_API_SECRET = "livekit-test-secret";
    process.env.R2_ENDPOINT = "https://r2.example";
    process.env.R2_ACCESS_KEY_ID = "r2-key";
    process.env.R2_SECRET_ACCESS_KEY = "r2-secret";
    process.env.R2_BUCKET = "recordings";
    receiveWebhook.mockResolvedValue({
      event: "egress_ended",
      egressInfo: {
        egressId: "egress-1",
        status: 3,
        endedAt: 1_700_000_000_000_000_000n,
        fileResults: [{ duration: 12_000_000_000n }],
      },
    });
  });

  it("posts the signed recording URL to Deepgram and extracts its transcript", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: { channels: [{ alternatives: [{ transcript: "  hello meeting  " }] }] },
    }), { status: 200 }));

    await expect(transcribeDeepgram("https://r2.example/signed", fetchMock as any))
      .resolves.toBe("hello meeting");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepgram.com/v1/listen?model=nova-3&diarize_model=latest&utterances=true&smart_format=true&detect_language=true",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Token deepgram-test-key" }),
        body: JSON.stringify({ url: "https://r2.example/signed" }),
      }),
    );
  });

  it("parses diarized utterances into millisecond segments", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: {
        channels: [{ alternatives: [{ transcript: "hello there" }] }],
        utterances: [
          { start: 0.25, end: 1.5, speaker: 2, transcript: " hello there " },
        ],
      },
    }), { status: 200 }));

    await expect(transcribeDeepgramWithSegments("https://r2.example/signed", fetchMock as any))
      .resolves.toEqual({
        text: "hello there",
        segments: [{ startMs: 250, endMs: 1500, speaker: 2, text: "hello there" }],
      });
  });

  it("keeps the provider error body for recording diagnostics", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ err_code: "INVALID_ARGUMENT", message: "audio URL expired" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));

    await expect(transcribeDeepgramWithSegments("https://r2.example/signed", fetchMock as any))
      .rejects.toThrow("Deepgram transcription failed (400): {\"err_code\":\"INVALID_ARGUMENT\",\"message\":\"audio URL expired\"}");
  });

  it("marks a recording as recording only when the egress reports it started", async () => {
    receiveWebhook.mockResolvedValueOnce({ event: "egress_started", egressInfo: { egressId: "egress-1" } });
    const runMutation = vi.fn(async () => "recording-1");
    await expect((handleEgressWebhook as any)._handler({ runMutation }, {
      body: "{}",
      authHeader: "Bearer livekit",
    })).resolves.toEqual({ handled: true, transcribed: false });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), { egressId: "egress-1" });

    receiveWebhook.mockResolvedValueOnce({ event: "egress_started", egressInfo: { egressId: "egress-2" } });
    await expect((handleEgressWebhook as any)._handler({ runMutation: vi.fn(async () => null) }, {
      body: "{}",
      authHeader: "Bearer livekit",
    })).rejects.toThrow("Recording reservation not found");
  });

  it("authenticates an egress-ended webhook, normalizes nanoseconds, and persists text", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: {
        channels: [{ alternatives: [{ transcript: "hello" }] }],
        utterances: [{ start: 0, end: 1.25, speaker: 0, transcript: "hello" }],
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const mutationArgs: any[] = [];
    const ctx = {
      runMutation: vi.fn(async (_reference: unknown, args: any) => {
        mutationArgs.push(args);
        if (args.egressId) {
          return { recordingId: "recording-1", storagePath: "org/room.mp4", status: "completed" };
        }
        if (args.text !== undefined) return undefined;
        return true;
      }),
    };

    await expect((handleEgressWebhook as any)._handler(ctx, {
      body: "{\"event\":\"egress_ended\"}",
      authHeader: "Bearer livekit",
    })).resolves.toEqual({ handled: true, transcribed: true });

    expect(receiveWebhook).toHaveBeenCalledWith("{\"event\":\"egress_ended\"}", "Bearer livekit");
    expect(mutationArgs[0]).toMatchObject({
      egressId: "egress-1",
      status: "completed",
      stoppedAt: 1_700_000_000_000,
      durationMs: 12_000,
    });
    expect(signedUrl).toHaveBeenCalled();
    expect(mutationArgs.at(-1)).toMatchObject({
      recordingId: "recording-1",
      text: "hello",
      segments: [{ startMs: 0, endMs: 1250, speaker: 0, text: "hello" }],
    });
  });

  it("starts exactly one egress for simultaneous recording requests in a self-hosted room", async () => {
    // Both actions can read the same timestamp. Only the action that inserted the row may call LiveKit.
    const timestamp = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const runMutation = vi.fn(async (_reference: unknown, args: any) => {
      if (args.startedAt !== undefined) {
        if (args.orgId === null) throw new Error("null is not a valid optional organization ID");
        return { id: "recording-1", created: runMutation.mock.calls.filter(([, call]) => call.startedAt !== undefined).length === 1 };
      }
    });
    const ctx = {
      runQuery: vi.fn(async (_reference: unknown, args: any) => args.roomId
        ? { roomSlug: "meet", livekitRoomName: "meet", orgId: null, externalId: "owner-1" }
        : { id: args.id, startedAt: Date.now(), status: "starting" }),
      runMutation,
    };

    try {
      const results = await Promise.all([
        (start as any)._handler(ctx, { roomId: "room-1" }),
        (start as any)._handler(ctx, { roomId: "room-1" }),
      ]);
      expect(results.map(result => result.id)).toEqual(["recording-1", "recording-1"]);
      expect(startEgress).toHaveBeenCalledTimes(1);
      expect(runMutation).toHaveBeenCalledWith(expect.anything(), { id: "recording-1", egressId: "egress-1" });
    } finally {
      timestamp.mockRestore();
    }
  });

  it("surfaces the paid-plan recording restriction to the client", async () => {
    let queryCount = 0;
    const ctx = {
      runQuery: vi.fn(async () => {
        if (queryCount++ === 0) {
          return { roomSlug: "meet", orgId: "org-1", externalId: "owner-1" };
        }
        return { planId: "free", usage: { recordingMinutesUsed: 0 } };
      }),
    };

    await expect((start as any)._handler(ctx, { roomId: "room-1" }))
      .rejects.toThrow("Recording is only available on paid plans");
  });

  it("checks the plan of the workspace that owns the room", async () => {
    const ctx = {
      runQuery: vi.fn()
        .mockResolvedValueOnce({ roomSlug: "meet", orgId: "room-workspace", externalId: "owner-1" })
        .mockImplementationOnce(async (_reference, args) => ({ planId: args.roomId === "room-1" ? "free" : "pro" })),
      runMutation: vi.fn(),
    };

    await expect((start as any)._handler(ctx, { roomId: "room-1" }))
      .rejects.toThrow("Recording is only available on paid plans");
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("waits for the egress completion webhook before publishing a stopped recording", async () => {
    const recording = { id: "recording-1", roomId: "room-1", egressId: "egress-1", status: "recording" };
    const ctx = {
      runQuery: vi.fn(async (_reference, args) => args.id ? recording : null),
      runMutation: vi.fn(),
    };
    stopEgress.mockResolvedValueOnce({ egressId: "egress-1", status: 2 });
    await expect((stop as any)._handler(ctx, { recordingId: recording.id })).resolves.toEqual(recording);
    expect(stopEgress).toHaveBeenCalledWith("egress-1");
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("leaves a recording retryable when LiveKit did not acknowledge the stop request", async () => {
    const recording = { id: "recording-1", roomId: "room-1", egressId: "egress-1", status: "recording" };
    const ctx = {
      runQuery: vi.fn(async (_reference, args) => args.id ? recording : null),
      runMutation: vi.fn(),
    };
    stopEgress.mockRejectedValueOnce(new Error("Egress temporarily unavailable"));
    await expect((stop as any)._handler(ctx, { recordingId: recording.id })).rejects.toThrow("Egress temporarily unavailable");
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
