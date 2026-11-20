import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { checkUploadRateLimit } from './lib/rateLimit';

const requireAuthenticatedUpload = async (ctx: any, errorMessage: string) => {
  const auth = (ctx as any).auth;
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null;
  if (!identity) {
    throw new Error(errorMessage);
  }
};

/**
 * Generate an upload URL for background images.
 * The URL expires in 1 hour and should be used immediately.
 * Requires authentication and is rate-limited to 5 uploads per hour.
 */
export const generateBackgroundUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedUpload(ctx, 'Must be signed in to generate upload URLs');

    // Apply rate limiting (5 uploads per hour)
    await checkUploadRateLimit(ctx);

    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Convert a storage ID to a public URL.
 * This URL can be stored in the room branding configuration.
 * Requires authentication.
 */
export const saveBackgroundImage = mutation({
  args: {
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUpload(ctx, 'Must be signed in to save images');

    const url = await ctx.storage.getUrl(args.storageId);
    return url;
  },
});

/**
 * Generate an upload URL for room partner logos.
 */
export const generateLogoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedUpload(ctx, 'Must be signed in to generate upload URLs');
    await checkUploadRateLimit(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Convert a logo storage ID to a public URL.
 */
export const saveLogoImage = mutation({
  args: {
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedUpload(ctx, 'Must be signed in to save images');

    const url = await ctx.storage.getUrl(args.storageId);
    return url;
  },
});
