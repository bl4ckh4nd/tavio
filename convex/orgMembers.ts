import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const ORG_ADMIN_ROLES = ["OWNER", "ADMIN"];

const mapMember = (membership: any, user: any | null) => {
  const { _id, _creationTime, ...rest } = membership;
  return {
    membershipId: _id,
    userId: membership.userId as string,
    orgRole: membership.role as string,
    name: user?.name ?? membership.userId,
    email: user?.email ?? membership.userId,
    externalId: user?.externalId ?? membership.userId,
    createdAt: rest.createdAt as number,
  };
};

export async function getCurrentMembership(ctx: any) {
  const auth = (ctx as any).auth;
  const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null;
  if (!identity) return null;

  const externalId = identity.subject;
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_user", (q: any) => q.eq("userId", externalId))
    .first();
  return membership;
}

export async function requireOrgAdmin(ctx: any) {
  const membership = await getCurrentMembership(ctx);
  if (!membership) {
    throw new Error("You are not a member of any organization.");
  }
  if (!ORG_ADMIN_ROLES.includes(membership.role)) {
    throw new Error("Only organization admins can manage members.");
  }
  return membership;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const current = await getCurrentMembership(ctx);
    if (!current) return [];

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q: any) => q.eq("orgId", current.orgId))
      .collect();

    const results: ReturnType<typeof mapMember>[] = [];
    for (const m of memberships) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_externalId", (q: any) => q.eq("externalId", m.userId))
        .first();
      results.push(mapMember(m, user));
    }
    return results;
  },
});

export const invite = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    // SECURITY: Validate org role enum to prevent invalid roles
    role: v.optional(v.union(v.literal("OWNER"), v.literal("ADMIN"), v.literal("MEMBER"))),
  },
  handler: async (ctx, args) => {
    const current = await requireOrgAdmin(ctx);
    const auth = (ctx as any).auth;
    const identity = auth?.getUserIdentity ? await auth.getUserIdentity() : null;
    const email = args.email.toLowerCase().trim();
    const orgRole = args.role ?? "MEMBER";

    let user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q: any) => q.eq("externalId", email))
      .first();

    if (user) {
      if (args.name && args.name !== user.name) {
        await ctx.db.patch(user._id, {
          name: args.name,
        });
        user = { ...user, name: args.name };
      }
    } else {
      const id = await ctx.db.insert("users", {
        externalId: email,
        name: args.name ?? email,
        avatarUrl: undefined,
        role: "Participant",
      });
      user = await ctx.db.get(id);
    }

    if (!user) {
      throw new Error("Failed to create user for invite.");
    }

    let membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q: any) => q.eq("orgId", current.orgId))
      .filter((q: any) => q.eq(q.field("userId"), email))
      .first();

    if (membership) {
      await ctx.db.patch(membership._id, { role: orgRole });
      membership = { ...membership, role: orgRole };
    } else {
      const membershipId = await ctx.db.insert("orgMemberships", {
        orgId: current.orgId,
        userId: email,
        role: orgRole,
        createdAt: Date.now(),
      });
      membership = await ctx.db.get(membershipId);
    }

    return membership ? mapMember(membership, user) : null;
  },
});

export const _enqueueInviteEmail = internalMutation({
  args: {
    email: v.string(),
    orgId: v.id("organizations"),
    inviterName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // This internal mutation exists only so that the generated API includes the
    // email action; the actual sending is done via `email.sendOrgInvite`.
    // No-op at runtime.
    return;
  },
});

export const updateRole = mutation({
  args: {
    membershipId: v.id("orgMemberships"),
    // SECURITY: Validate org role enum to prevent invalid roles
    role: v.union(v.literal("OWNER"), v.literal("ADMIN"), v.literal("MEMBER")),
  },
  handler: async (ctx, args) => {
    const current = await requireOrgAdmin(ctx);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) return null;
    if (membership.orgId !== current.orgId) {
      throw new Error("You cannot manage members outside your organization.");
    }

    await ctx.db.patch(args.membershipId, { role: args.role });
    const user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q: any) =>
        q.eq("externalId", membership.userId),
      )
      .first();

    return mapMember({ ...membership, role: args.role }, user);
  },
});

export const remove = mutation({
  args: {
    membershipId: v.id("orgMemberships"),
  },
  handler: async (ctx, args) => {
    const current = await requireOrgAdmin(ctx);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) return null;
    if (membership.orgId !== current.orgId) {
      throw new Error("You cannot manage members outside your organization.");
    }

    // Prevent removing the last OWNER (lightweight guard).
    if (membership.role === "OWNER") {
      const owners = await ctx.db
        .query("orgMemberships")
        .withIndex("by_org", (q: any) => q.eq("orgId", current.orgId))
        .filter((q: any) => q.eq(q.field("role"), "OWNER"))
        .collect();
      if (owners.length <= 1) {
        throw new Error("At least one owner must remain in the organization.");
      }
    }

    await ctx.db.delete(args.membershipId);
    return { membershipId: args.membershipId };
  },
});
