"use node"

import { TokenVerifier } from "livekit-server-sdk"

export const verifySessionCredential = async (
  credential: string,
  apiKey: string,
  apiSecret: string,
) => {
  const claims = await new TokenVerifier(apiKey, apiSecret).verify(credential)
  const attributes = claims.attributes ?? {}
  const isSessionCredential = attributes.breakoutCredential === "1" || attributes.sessionCredential === "1"
  if (!isSessionCredential || claims.video?.roomJoin) {
    throw new Error("Invalid breakout session credential")
  }
  const mainRoom = attributes.mainRoom || attributes.parentRoom
  if (!claims.sub || !mainRoom) {
    throw new Error("Invalid breakout session credential")
  }
  return {
    identity: claims.sub,
    mainRoom,
    name: attributes.name || claims.name || claims.sub,
    role: attributes.role || "Participant",
    issuedAt: Number(attributes.issuedAt) || undefined,
  }
}

// Kept for existing breakout action callers and older credentials.
export const verifyBreakoutCredential = verifySessionCredential
