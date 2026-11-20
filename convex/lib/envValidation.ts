/**
 * Environment variable validation utilities.
 * Call these at module initialization to fail fast if env is misconfigured.
 */

/**
 * Require a specific environment variable to be set.
 *
 * @param key - Environment variable name
 * @returns The environment variable value
 * @throws Error if environment variable is not set
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Please set it via 'npx convex env set ${key} <value>'`
    );
  }
  return value;
}

/**
 * Validate and return LiveKit environment variables.
 *
 * @returns Object containing LiveKit API credentials
 * @throws Error if any required LiveKit env var is missing
 */
export function requireEnvForLiveKit() {
  const errors: string[] = [];

  if (!process.env.LIVEKIT_API_KEY) {
    errors.push('LIVEKIT_API_KEY');
  }
  if (!process.env.LIVEKIT_API_SECRET) {
    errors.push('LIVEKIT_API_SECRET');
  }
  if (!process.env.LIVEKIT_HOST) {
    errors.push('LIVEKIT_HOST');
  }

  if (errors.length > 0) {
    throw new Error(
      `Missing required LiveKit environment variables: ${errors.join(', ')}. ` +
      `Set them via 'npx convex env set <VAR> <value>'`
    );
  }

  return {
    apiKey: process.env.LIVEKIT_API_KEY!,
    apiSecret: process.env.LIVEKIT_API_SECRET!,
    host: process.env.LIVEKIT_HOST!
  };
}

/**
 * LIVEKIT_HOST is the websocket URL handed to browsers; the Room Service API is
 * served over HTTP(S) on the same host (ws -> http, wss -> https). Set
 * LIVEKIT_API_HOST when the backend reaches LiveKit on a different address,
 * e.g. a container network name.
 */
export function roomServiceHost(host: string): string {
  return (process.env.LIVEKIT_API_HOST || host).replace(/^ws/i, 'http');
}

/**
 * Validate Better Auth environment variables.
 *
 * @throws Error if required auth environment variables are missing or invalid
 */
export function requireEnvForAuth() {
  const secret = requireEnv('BETTER_AUTH_SECRET');
  const siteUrl = requireEnv('SITE_URL');
  const convexSiteUrl = requireEnv('CONVEX_SITE_URL');

  // Basic URL shape checks to catch common misconfigurations early.
  if (!siteUrl.startsWith('http://') && !siteUrl.startsWith('https://')) {
    throw new Error(
      `Invalid SITE_URL: "${siteUrl}". Expected a full URL such as http://localhost:3333`
    );
  }

  let convexSite: URL;
  try {
    convexSite = new URL(convexSiteUrl);
  } catch {
    throw new Error(
      `Invalid CONVEX_SITE_URL: "${convexSiteUrl}". Expected a full URL such as https://<deployment>.convex.site`
    );
  }

  const isLocalHttp =
    convexSite.protocol === 'http:' &&
    (convexSite.hostname === 'localhost' || convexSite.hostname === '127.0.0.1');
  if (convexSite.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(
      `Invalid CONVEX_SITE_URL: "${convexSiteUrl}". Expected https://<deployment>.convex.site or http://localhost:3211`
    );
  }

  if (secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET must be at least 32 characters for security'
    );
  }
}
