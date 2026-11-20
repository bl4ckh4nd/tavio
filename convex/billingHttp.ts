import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// httpAction must live in the Convex runtime (no "use node").
// Actual Stripe SDK work is delegated to the Node.js action in billingActions.ts.
export const stripeWebhook = httpAction(async (ctx, request) => {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await request.text();

  try {
    await ctx.runAction(internal.billingActions.processStripeWebhook, { body, signature });
    return new Response("ok", { status: 200 });
  } catch (error: any) {
    return new Response(error?.message ?? "Webhook processing failed", { status: 400 });
  }
});
