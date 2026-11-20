import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const PAGE_SIZE = 200;
const CONFIRM_RESET = "RESET_BETTER_AUTH_JWKS";

type BetterAuthModel = "jwks" | "session";

function nextCursor(result: {
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
  splitCursor?: string | null;
  continueCursor: string | null;
}): string | null {
  if (result.pageStatus === "SplitRecommended" || result.pageStatus === "SplitRequired") {
    return result.splitCursor ?? result.continueCursor;
  }
  return result.continueCursor;
}

async function countRows(ctx: any, model: BetterAuthModel): Promise<number> {
  let cursor: string | null = null;
  let total = 0;

  while (true) {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model,
      paginationOpts: {
        numItems: PAGE_SIZE,
        cursor,
      },
    });

    total += Array.isArray(result.page) ? result.page.length : 0;
    if (result.isDone) break;

    cursor = nextCursor(result);
    if (!cursor) break;
  }

  return total;
}

async function deleteRows(ctx: any, model: BetterAuthModel): Promise<number> {
  let cursor: string | null = null;
  let deleted = 0;

  while (true) {
    const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model },
      paginationOpts: {
        numItems: PAGE_SIZE,
        cursor,
      },
    });

    deleted += Number(result.count ?? 0);
    if (result.isDone) break;

    cursor = nextCursor(result);
    if (!cursor) break;
  }

  return deleted;
}

/**
 * Reset Better Auth JWKS (and optionally sessions) in the component data store.
 *
 * Use with CLI:
 * npx convex run authMaintenance:resetBetterAuthJwksAndSessions '{"confirm":"RESET_BETTER_AUTH_JWKS","dryRun":true}'
 */
export const resetBetterAuthJwksAndSessions = internalMutation({
  args: {
    confirm: v.string(),
    dryRun: v.optional(v.boolean()),
    clearSessions: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.confirm !== CONFIRM_RESET) {
      throw new Error(
        `Confirmation string mismatch. Pass confirm="${CONFIRM_RESET}" to run this maintenance command.`
      );
    }

    const shouldClearSessions = args.clearSessions !== false;
    const isDryRun = args.dryRun === true;

    const jwksBefore = await countRows(ctx, "jwks");
    const sessionsBefore = shouldClearSessions ? await countRows(ctx, "session") : 0;

    if (isDryRun) {
      return {
        dryRun: true,
        clearSessions: shouldClearSessions,
        jwksBefore,
        sessionsBefore,
        jwksDeleted: 0,
        sessionsDeleted: 0,
      };
    }

    const jwksDeleted = await deleteRows(ctx, "jwks");
    const sessionsDeleted = shouldClearSessions ? await deleteRows(ctx, "session") : 0;

    const jwksAfter = await countRows(ctx, "jwks");
    const sessionsAfter = shouldClearSessions ? await countRows(ctx, "session") : 0;

    return {
      dryRun: false,
      clearSessions: shouldClearSessions,
      jwksBefore,
      sessionsBefore,
      jwksDeleted,
      sessionsDeleted,
      jwksAfter,
      sessionsAfter,
    };
  },
});
