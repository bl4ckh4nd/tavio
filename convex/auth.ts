import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth } from "better-auth";
import { Resend } from "@convex-dev/resend";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { requireEnvForAuth } from "./lib/envValidation";
import authConfig from "./auth.config";

// Validate critical environment variables at module initialization
requireEnvForAuth();

const siteUrl = process.env.SITE_URL as string | undefined;
const githubClientId = process.env.GITHUB_CLIENT_ID as string | undefined;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET as string | undefined;
const googleClientId = process.env.GOOGLE_CLIENT_ID as string | undefined;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET as string | undefined;
const resendFrom =
  process.env.RESEND_FROM_EMAIL ?? "Tavio <no-reply@example.com>";
const resendDevTo = process.env.RESEND_DEV_TO as string | undefined;
const nodeEnv = process.env.NODE_ENV;
const isProduction = nodeEnv === "production";

// Extra trusted origins for non-production environments (e.g. local E2E tests).
// In dev-stage: set via `npx convex env set EXTRA_TRUSTED_ORIGINS http://localhost:3333`
// Multiple origins can be comma-separated: http://localhost:3333,http://localhost:5173
const extraTrustedOrigins: string[] = isProduction
  ? []
  : [
      // Always allow localhost in non-production for local E2E / dev workflows
      'http://localhost:3333',
      'http://localhost:5173',
      // Allow any explicitly configured extra origins
      ...(process.env.EXTRA_TRUSTED_ORIGINS ?? '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean),
    ];

const resend = new Resend(components.resend);

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  const socialProviders: Record<string, any> = {};

  if (githubClientId && githubClientSecret) {
    socialProviders.github = {
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    };
  }

  if (googleClientId && googleClientSecret) {
    socialProviders.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    };
  }

  return betterAuth({
    // Auth runs on the Convex site; reset links and OAuth callbacks point there, never at the request's host.
    baseURL: process.env.CONVEX_SITE_URL,
    logger: {
      disabled: optionsOnly,
    },
    trustedOrigins: [...(siteUrl ? [siteUrl] : []), ...extraTrustedOrigins],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      async sendResetPassword({ user, url }) {
        if (!siteUrl) return;
        const actionCtx = requireActionCtx(ctx);
        const to =
          isProduction || !resendDevTo ? user.email : resendDevTo;
        await resend.sendEmail(actionCtx, {
          from: resendFrom,
          to,
          subject: "Reset your Tavio password",
          html: `
            <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; padding: 24px;">
              <h1 style="font-size: 20px; margin-bottom: 12px;">Reset your password</h1>
              <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
                We received a request to reset your Tavio password. Click the button below to choose a new password.
              </p>
              <p style="margin: 24px 0;">
                <a href="${url}"
                   style="display: inline-block; padding: 10px 18px; border-radius: 999px; background-color: #10b981; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none;">
                  Reset password
                </a>
              </p>
              <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
                If the button doesn’t work, copy and paste this link into your browser:<br/>
                <span style="word-break: break-all; color: #0f172a;">${url}</span>
              </p>
              <p style="font-size: 12px; line-height: 1.6; color: #94a3b8; margin-top: 16px;">
                If you didn’t request this, you can safely ignore this email.
              </p>
              ${
                !isProduction && resendDevTo
                  ? `<p style="font-size: 11px; line-height: 1.6; color: #cbd5f5; margin-top: 12px;">
                       Dev mode: this email was originally addressed to <strong>${user.email}</strong> but sent to <strong>${resendDevTo}</strong>.
                     </p>`
                  : ""
              }
            </div>
          `,
        });
      },
    },
    emailVerification: {
      enabled: true,
      sendOnSignUp: true,
      async sendVerificationEmail({ user, url }) {
        if (!siteUrl) return;
        const actionCtx = requireActionCtx(ctx);
        const to =
          isProduction || !resendDevTo ? user.email : resendDevTo;
        // Verification is optional (requireEmailVerification: false); a mail failure must not fail sign-up after the user row exists.
        await resend.sendEmail(actionCtx, {
          from: resendFrom,
          to,
          subject: "Verify your Tavio account",
          html: `
            <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; padding: 24px;">
              <h1 style="font-size: 20px; margin-bottom: 12px;">Welcome to Tavio</h1>
              <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
                Thanks for signing up. Please confirm your email address to finish creating your workspace and start joining meetings.
              </p>
              <p style="margin: 24px 0;">
                <a href="${url}"
                   style="display: inline-block; padding: 10px 18px; border-radius: 999px; background-color: #10b981; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none;">
                  Verify email
                </a>
              </p>
              <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
                If the button doesn’t work, copy and paste this link into your browser:<br/>
                <span style="word-break: break-all; color: #0f172a;">${url}</span>
              </p>
              <p style="font-size: 12px; line-height: 1.6; color: #94a3b8; margin-top: 16px;">
                If you didn’t create a Tavio account, you can ignore this email.
              </p>
              ${
                !isProduction && resendDevTo
                  ? `<p style="font-size: 11px; line-height: 1.6; color: #cbd5f5; margin-top: 12px;">
                       Dev mode: this email was originally addressed to <strong>${user.email}</strong> but sent to <strong>${resendDevTo}</strong>.
                     </p>`
                  : ""
              }
            </div>
          `,
        }).catch((error) => {
          console.error("Verification email could not be sent", error);
        });
      },
    },
    socialProviders: Object.keys(socialProviders).length ? socialProviders : undefined,
    plugins: [
      ...(siteUrl ? [crossDomain({ siteUrl })] : []),
      // Existing deployments still hold an EdDSA key from before the RS256 switch.
      // This replaces it on the first token request after the upgrade.
      convex({ authConfig, jwksRotateOnTokenGenerationError: true }),
    ],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
