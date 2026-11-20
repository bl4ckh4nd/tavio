import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const mapOrg = (doc: any) => {
  const { _id, _creationTime, ...rest } = doc;
  return { id: _id, ...rest };
};

export async function ensureDefaultOrgForUser(
  ctx: any,
  externalId: string,
  name?: string,
) {
  const existingMembership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_user", (q: any) => q.eq("userId", externalId))
    .first();

  if (existingMembership) {
    const org = await ctx.db.get(existingMembership.orgId);
    return org ? mapOrg(org) : null;
  }

  const slugBaseFromName =
    name?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ??
    "";
  const slugBaseFromId =
    externalId.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ?? "";
  const base = slugBaseFromName || slugBaseFromId || "workspace";

  let slug = base;
  let suffix = 1;
  // ensure slug uniqueness
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q: any) => q.eq("slug", slug))
      .first();
    if (!existing) break;
    suffix += 1;
    slug = `${base}-${suffix}`;
  }

  const orgId = await ctx.db.insert("organizations", {
    slug,
    name: name ?? `${base.charAt(0).toUpperCase()}${base.slice(1)} Workspace`,
    createdAt: Date.now(),
  });

  await ctx.db.insert("orgMemberships", {
    orgId,
    userId: externalId,
    role: "OWNER",
    createdAt: Date.now(),
  });

  const org = await ctx.db.get(orgId);
  return org ? mapOrg(org) : null;
}

export const listForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const auth = (ctx as any).auth;
    const identity = auth?.getUserIdentity
      ? await auth.getUserIdentity()
      : null;
    if (!identity) return [];

    const externalId = identity.subject;
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q) => q.eq("userId", externalId))
      .collect();

    if (memberships.length === 0) return [];

    const orgIds = memberships.map((m) => m.orgId);
    const orgs = await Promise.all(
      orgIds.map((id) => ctx.db.get(id)),
    );

    return orgs
      .map((o, idx) => {
        if (!o) return null;
        const mapped = mapOrg(o);
        return {
          ...mapped,
          role: memberships[idx]?.role ?? "MEMBER",
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  },
});

export const update = mutation({
  args: {
    id: v.id("organizations"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = (ctx as any).auth;
    const identity = auth?.getUserIdentity
      ? await auth.getUserIdentity()
      : null;
    if (!identity) {
      throw new Error("You must be signed in to update the workspace");
    }
    const externalId = identity.subject;

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user", (q: any) => q.eq("userId", externalId))
      .first();

    if (!membership || membership.orgId !== args.id) {
      throw new Error("You are not a member of this workspace");
    }
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new Error("Only owners and admins can rename the workspace");
    }

    await ctx.db.patch(args.id, { name: args.name });
    const updated = await ctx.db.get(args.id);
    return updated ? mapOrg(updated) : null;
  },
});
