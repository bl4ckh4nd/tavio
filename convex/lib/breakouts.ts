export type BreakoutMode = "native" | "reconnect"

export const resolveBreakoutMode = (
  host: string,
  configured: string | undefined = process.env.LIVEKIT_BREAKOUT_MODE,
): BreakoutMode => {
  if (configured === "native" || configured === "reconnect") return configured
  try {
    const hostname = new URL(host).hostname.toLowerCase()
    return hostname === "livekit.cloud" || hostname.endsWith(".livekit.cloud")
      ? "native"
      : "reconnect"
  } catch {
    return "reconnect"
  }
}

export const resolveParticipantBreakoutRoom = (
  session: any,
  identity: string,
  isManager: boolean,
  reportedRoomId?: string,
  reportedLivekitRoomName?: string,
  expectedGeneration?: number,
) => {
  if (!session || session.status !== "active") return "main"
  const assignment = session.assignments?.find((entry: any) => entry.identity === identity)
  if (!isManager) return assignment?.roomId || "main"
  if (expectedGeneration !== undefined && session.generation !== expectedGeneration) return "main"
  const candidate = reportedRoomId || "main"
  if (candidate === "main") return "main"
  const target = session.rooms?.find((entry: any) => entry.id === candidate)
  if (!target) return "main"
  if (reportedLivekitRoomName && reportedLivekitRoomName !== target.livekitRoomName) return "main"
  return candidate
}

export const makeBreakoutRoomName = (parentSlug: string, generation: number, index: number) =>
  `${parentSlug}__breakout__${generation}__${index + 1}`

/**
 * Validate the generated LiveKit naming contract without consulting session
 * history. A participant can still be in an ended room while a new session is
 * being started, so the database cannot be the source of truth for this check.
 */
export const isGeneratedBreakoutRoomName = (parentSlug: string, roomName: string) => {
  const escapedSlug = parentSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escapedSlug}__breakout__[1-9]\\d*__[1-9]\\d*$`).test(roomName)
}
