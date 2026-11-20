import { createAuthClient } from "better-auth/react";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";

const baseURL = import.meta.env.VITE_CONVEX_SITE_URL;

if (!baseURL) {
  // eslint-disable-next-line no-console
  console.warn("VITE_CONVEX_SITE_URL is not set. Better Auth client will not work correctly.");
}

export const authClient = createAuthClient({
  baseURL: baseURL!,
  plugins: [convexClient(), crossDomainClient()],
});

