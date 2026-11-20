import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Keep the HTTP boundary in Convex's runtime; WebhookReceiver runs in the Node action.
export const livekitEgressWebhook = httpAction(async (ctx, request) => {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return new Response("Missing Authorization header", { status: 401 });

  try {
    await ctx.runAction(internal.recordingActions.handleEgressWebhook, {
      body: await request.text(),
      authHeader,
    });
    return new Response("ok", { status: 200 });
  } catch (error: any) {
    return new Response(error?.message ?? "Webhook processing failed", { status: 400 });
  }
});
