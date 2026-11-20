"use node";

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { extractLogoCandidates } from './lib/logoDiscovery';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_CANDIDATES_TO_TRY = 6;

const fetchPageHtml = async (websiteUrl: string) => {
  const response = await fetch(websiteUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Website request failed with ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    throw new Error('Partner website did not return an HTML page');
  }

  return {
    html: await response.text(),
    finalUrl: response.url || websiteUrl,
  };
};

const downloadCandidateLogo = async (candidateUrl: string) => {
  const response = await fetch(candidateUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    return null;
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_SIZE_BYTES) {
    return null;
  }

  const blob = await response.blob();
  if (!blob.type.startsWith('image/') || blob.size > MAX_IMAGE_SIZE_BYTES) {
    return null;
  }

  return blob;
};

const toLogoDiscoveryError = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Automatic logo discovery failed';
};

export const discoverLogoForRoom = internalAction({
  args: {
    roomId: v.id('rooms'),
    websiteUrl: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const room = await ctx.runQuery(internal.rooms.getLogoDiscoveryContext, {
      roomId: args.roomId,
    });

    if (!room?.branding?.partnerWebsiteUrl || room.branding.partnerWebsiteUrl !== args.websiteUrl) {
      return;
    }

    try {
      const { html, finalUrl } = await fetchPageHtml(args.websiteUrl);
      const candidates = extractLogoCandidates(html, finalUrl).slice(0, MAX_CANDIDATES_TO_TRY);

      for (const candidate of candidates) {
        const blob = await downloadCandidateLogo(candidate.url);
        if (!blob) {
          continue;
        }

        const storageId = await ctx.storage.store(blob);
        const storedUrl = await ctx.storage.getUrl(storageId);
        if (!storedUrl) {
          throw new Error('Stored logo URL could not be generated');
        }

        await ctx.runMutation(internal.rooms.applyLogoDiscoverySuccess, {
          roomId: args.roomId,
          websiteUrl: args.websiteUrl,
          logoUrl: storedUrl,
          logoStorageId: String(storageId),
        });
        return;
      }

      await ctx.runMutation(internal.rooms.applyLogoDiscoveryFailure, {
        roomId: args.roomId,
        websiteUrl: args.websiteUrl,
        error: 'No suitable logo candidate was found on the partner website',
      });
    } catch (error) {
      await ctx.runMutation(internal.rooms.applyLogoDiscoveryFailure, {
        roomId: args.roomId,
        websiteUrl: args.websiteUrl,
        error: toLogoDiscoveryError(error),
      });
    }
  },
});
