// Convex actions for meeting-wide control that must reach the LiveKit server.
"use node"

import { action } from "./_generated/server"
import { ConvexError, v } from "convex/values"
import { RoomServiceClient } from "livekit-server-sdk"
import { api, internal } from "./_generated/api"
import { requireEnvForLiveKit, roomServiceHost } from "./lib/envValidation"

// Long enough for clients to route to the endscreen first: their room queries
// start failing the moment the grant is gone.
const GRANT_REVOKE_DELAY_MS = 60 * 1000

/**
 * Ends the meeting for everyone. Clients observe DisconnectReason.ROOM_DELETED
 * and route to the endscreen.
 *
 * The room stays reusable: only a host can rejoin right away, everyone else
 * after MEETING_END_REJOIN_BLOCK_MS. The next session runs under a new LiveKit
 * room name, so pre-end tokens cannot reach it.
 */
export const endForAll = action({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<{ closedRooms: number }> => {
    const targets: { livekitRoomNames: string[] } = await ctx.runQuery(
      internal.rooms.getMeetingEndTargets,
      { roomId: args.roomId },
    )
    const { apiKey, apiSecret, host } = requireEnvForLiveKit()
    const client = new RoomServiceClient(roomServiceHost(host), apiKey, apiSecret)

    const mainRoomName = targets.livekitRoomNames[targets.livekitRoomNames.length - 1]
    let closedRooms = 0
    let mainRoomFailed = false
    for (const name of targets.livekitRoomNames) {
      try {
        await client.deleteRoom(name)
        closedRooms += 1
      } catch (error) {
        // A room nobody ever connected to does not exist on the server; the
        // remaining rooms still have to be closed.
        console.error(`[meetingActions] Failed to close LiveKit room ${name}`, error)
        if (name === mainRoomName && !isRoomNotFound(error)) mainRoomFailed = true
      }
    }

    // Reporting success here would leave everyone in the call while the host
    // believes it has ended.
    if (mainRoomFailed) {
      throw new ConvexError("Could not end the meeting because the media server is unreachable. Please try again.")
    }

    const endedAt = Date.now()
    await ctx.runMutation(internal.rooms.markMeetingEnded, { roomId: args.roomId, endedAt })
    await ctx.scheduler.runAfter(GRANT_REVOKE_DELAY_MS, internal.rooms.revokeAccessGrants, {
      roomId: args.roomId,
      issuedBefore: endedAt,
    })

    // Leaving the session active would block the next breakout start.
    await ctx.runMutation(api.breakouts.end, { roomId: args.roomId })
    return { closedRooms }
  },
})

const isRoomNotFound = (error: unknown) => {
  const err = error as { status?: number; code?: string; message?: string }
  return err?.status === 404 || err?.code === "not_found" || /not found/i.test(err?.message ?? "")
}
