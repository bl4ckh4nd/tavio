"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { Resend } from "@convex-dev/resend";
import { components } from "./_generated/api";

const siteUrl = process.env.SITE_URL as string | undefined;
const resendFrom =
  process.env.RESEND_FROM_EMAIL ?? "Tavio <no-reply@example.com>";
const resendDevTo = process.env.RESEND_DEV_TO as string | undefined;
const nodeEnv = process.env.NODE_ENV;
const isProduction = nodeEnv === "production";

const resend = new Resend(components.resend);

export const sendOrgInvite = action({
  args: {
    email: v.string(),
    orgName: v.string(),
    inviterName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!siteUrl) return;
    const to =
      isProduction || !resendDevTo ? args.email : resendDevTo;

    const greetingName = args.email.split("@")[0] ?? "there";
    const inviter = args.inviterName ?? "A teammate";

    await resend.sendEmail(ctx, {
      from: resendFrom,
      to,
      subject: `You’ve been invited to ${args.orgName} on Tavio`,
      html: `
        <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; padding: 24px;">
          <h1 style="font-size: 20px; margin-bottom: 12px;">Join the ${args.orgName} workspace</h1>
          <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
            ${inviter} invited you to collaborate in the <strong>${args.orgName}</strong> workspace on Tavio.
          </p>
          <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
            To join, sign in or create an account using this email address:
            <strong>${args.email}</strong>.
          </p>
          <p style="margin: 24px 0;">
            <a href="${siteUrl}/auth/register"
               style="display: inline-block; padding: 10px 18px; border-radius: 999px; background-color: #10b981; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none;">
              Get started
            </a>
          </p>
          <p style="font-size: 12px; line-height: 1.6; color: #64748b;">
            Or open this link in your browser:<br/>
            <span style="word-break: break-all; color: #0f172a;">${siteUrl}/auth/register</span>
          </p>
          <p style="font-size: 12px; line-height: 1.6; color: #94a3b8; margin-top: 16px;">
            If you weren’t expecting this invite, you can safely ignore this email.
          </p>
          ${
            !isProduction && resendDevTo
              ? `<p style="font-size: 11px; line-height: 1.6; color: #cbd5f5; margin-top: 12px;">
                   Dev mode: this email was originally addressed to <strong>${args.email}</strong> but sent to <strong>${resendDevTo}</strong>.
                 </p>`
              : ""
          }
        </div>
      `,
    });
  },
});

