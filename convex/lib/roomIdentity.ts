export type RoomIdentity = {
  roomId: string
  slug: string
  livekitRoomName: string
  access: string
  orgId?: string
}

/** ConvexError code for a client whose room access is missing, expired or revoked. */
export const ROOM_ACCESS_REQUIRED = "ROOM_ACCESS_REQUIRED"

/**
 * LiveKit cannot revoke tokens, so ending a meeting moves the room to a new
 * name: a token from before the end can only reach the abandoned one. Slugs
 * cannot contain underscores, so this never collides with another room.
 */
export const livekitRoomNameFor = (room: { slug: string; meetingGeneration?: number }) =>
  room.meetingGeneration ? `${room.slug}__session__${room.meetingGeneration}` : room.slug

export const toRoomIdentity = (room: any): RoomIdentity => ({
  roomId: String(room.id ?? room._id),
  slug: String(room.slug),
  livekitRoomName: livekitRoomNameFor(room),
  access: String(room.access),
  orgId: room.orgId ? String(room.orgId) : undefined,
})
