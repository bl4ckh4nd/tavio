"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import Stripe from "stripe";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePricePro = process.env.STRIPE_PRICE_PRO;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const siteUrl = process.env.SITE_URL ?? "";

const getStripeClient = () => {
  if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16" as any,
  });
};

const getOrgIdForCaller = async (ctx: any) => {
  const auth = (ctx as any).auth;
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null;
  if (!identity) {
    throw new Error("You must be signed in to manage billing");
  }
  const externalId = identity.subject;

  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_user", (q: any) => q.eq("userId", externalId))
    .first();
  if (!membership) {
    throw new Error("You do not belong to a workspace yet");
  }
  return membership.orgId;
};

const stripeUnixToMs = (value?: number | null) => (value ? value * 1000 : undefined);

export const createCheckoutSession = action({
  args: {
    planId: v.string(), // currently only "pro" is supported
  },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const orgId = await getOrgIdForCaller(ctx);
    const stripe = getStripeClient();

    if (args.planId !== "pro") {
      throw new Error("Only the Pro plan is supported via Stripe at the moment");
    }
    if (!stripePricePro) {
      throw new Error("STRIPE_PRICE_PRO is not set");
    }

    const successUrl = `${siteUrl}/admin?billing=success`;
    const cancelUrl = `${siteUrl}/admin?billing=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: stripePricePro,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        orgId: orgId,
      },
      subscription_data: {
        metadata: {
          orgId: orgId,
        },
      },
    });

    // SECURITY: Do NOT upgrade user to Pro immediately. Wait for Stripe webhook confirmation.
    // User will only be upgraded to Pro after 'checkout.session.completed' webhook is received
    // and payment is actually confirmed by Stripe. This prevents unauthorized Pro access.
    // The webhook handler (in production) should listen for 'checkout.session.completed'
    // and call _setSubscriptionForOrg with status: "active"

    return { url: session.url };
  },
});

export const createPortalSession = action({
  args: {},
  handler: async (ctx): Promise<{ url: string | null }> => {
    // Portal is not fully wired yet; the UI keeps this action disabled.
    return { url: null };
  },
});

export const processStripeWebhook = internalAction({
  args: {
    body: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    if (!stripeWebhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    }

    const stripe = getStripeClient();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(args.body, args.signature, stripeWebhookSecret);
    } catch (error: any) {
      throw new Error(`Webhook signature verification failed: ${error?.message ?? "unknown error"}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.orgId;
      if (orgId) {
        const periodStart = stripeUnixToMs((session as any).current_period_start);
        const periodEnd = stripeUnixToMs((session as any).current_period_end);
        await ctx.runMutation(internal.billing._setSubscriptionForOrg, {
          orgId: orgId as Id<"organizations">,
          planId: "pro",
          status: "active",
          stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
          stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : undefined,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        });
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata?.orgId;
      if (orgId) {
        const priceId = subscription.items.data[0]?.price?.id;
        const planId = priceId === stripePricePro ? "pro" : "free";
        await ctx.runMutation(internal.billing._setSubscriptionForOrg, {
          orgId: orgId as Id<"organizations">,
          planId,
          status: subscription.status,
          stripeCustomerId:
            typeof subscription.customer === "string" ? subscription.customer : undefined,
          stripeSubscriptionId: subscription.id,
          currentPeriodStart: stripeUnixToMs((subscription as any).current_period_start),
          currentPeriodEnd: stripeUnixToMs((subscription as any).current_period_end),
        });
      }
    }
  },
});
