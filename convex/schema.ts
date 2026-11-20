import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { WHITEBOARD_MORE_SHAPES, WHITEBOARD_STAMPS } from "../src/types"

const whiteboardElement = v.object({
  id: v.string(),
  type: v.union(
    v.literal("stroke"),
    v.literal("shape"),
    v.literal("rectangle"),
    v.literal("circle"),
    v.literal("text"),
    v.literal("image"),
    v.literal("line"),
    v.literal("stamp"),
    v.literal("html")
  ),
  x: v.optional(v.number()),
  y: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  // For strokes
  points: v.optional(v.array(v.object({ x: v.number(), y: v.number() }))),
  tool: v.optional(v.union(v.literal("pen"), v.literal("eraser"), v.literal("marker"))),
  color: v.optional(v.string()),
  size: v.optional(v.number()),
  strokeColor: v.optional(v.string()),
  strokeWidth: v.optional(v.number()),
  // For shapes
  shapeType: v.optional(v.union(
    v.literal("rectangle"), v.literal("circle"), v.literal("diamond"), v.literal("note"), v.literal("section"), v.literal("task"),
    v.literal("table"), v.literal("mindmap"),
    ...WHITEBOARD_MORE_SHAPES.map(kind => v.literal(kind))
  )),
  fillStyle: v.optional(v.union(v.literal("solid"), v.literal("hachure"), v.literal("cross-hatch"))),
  roundness: v.optional(v.union(v.literal("sharp"), v.literal("round"))),
  strokeStyle: v.optional(v.union(v.literal("solid"), v.literal("dashed"), v.literal("dotted"))),
  // For lines and arrows
  startArrow: v.optional(v.boolean()),
  endArrow: v.optional(v.boolean()),
  start: v.optional(v.object({ id: v.string(), fx: v.number(), fy: v.number() })),
  end: v.optional(v.object({ id: v.string(), fx: v.number(), fy: v.number() })),
  elbow: v.optional(v.boolean()),
  label: v.optional(v.string()),
  // For stamps: which one, and the element it sits on
  stamp: v.optional(v.union(...WHITEBOARD_STAMPS.map(kind => v.literal(kind)))),
  on: v.optional(v.object({ id: v.string(), fx: v.number(), fy: v.number() })),
  fillColor: v.optional(v.string()),
  // For text
  text: v.optional(v.string()),
  fontSize: v.optional(v.number()),
  fontFamily: v.optional(v.string()),
  textAlign: v.optional(v.union(v.literal("left"), v.literal("center"), v.literal("right"))),
  // For images
  src: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  imageStorageId: v.optional(v.string()),
  // For a page of HTML: the stored page and its title
  page: v.optional(v.string()),
  title: v.optional(v.string()),
  // Put there by the meeting assistant; its additions survive a save from a client that never showed them.
  author: v.optional(v.literal("assistant")),
  // The name of the person who wrote a note or put a stamp
  by: v.optional(v.string()),
  // For a table: its cells, row by row. For a mind map node: its parent node
  cells: v.optional(v.array(v.array(v.string()))),
  parent: v.optional(v.string()),
  // For a task card: ticked off, who does it, by when (YYYY-MM-DD)
  done: v.optional(v.boolean()),
  owner: v.optional(v.string()),
  due: v.optional(v.string()),
  // For every kind
  opacity: v.optional(v.number()),
  groupId: v.optional(v.string()),
  locked: v.optional(v.boolean())
})

export default defineSchema({
  rooms: defineTable({
    orgId: v.optional(v.id("organizations")),
    name: v.string(),
    slug: v.string(),
    type: v.string(),
    access: v.string(),
    passwordHash: v.optional(v.string()),
    activeParticipants: v.number(),
    activeHosts: v.optional(v.number()),
    maxParticipants: v.number(),
    locked: v.boolean(),
    recording: v.boolean(),
    createdAt: v.string(),
    meetingEndedAt: v.optional(v.number()),
    meetingReopenedAt: v.optional(v.number()),
    meetingGeneration: v.optional(v.number()),
    branding: v.optional(
      v.object({
        logoUrl: v.optional(v.string()),
        logoStorageId: v.optional(v.string()),
        logoSource: v.optional(v.string()),
        logoFetchStatus: v.optional(v.string()),
        logoFetchError: v.optional(v.string()),
        logoFetchedAt: v.optional(v.string()),
        partnerWebsiteUrl: v.optional(v.string()),
        primaryColor: v.optional(v.string()),
        backgroundImageUrl: v.optional(v.string()),
        backgroundStorageId: v.optional(v.string()),
        theme: v.optional(v.string())
      })
    )
  })
    .index("by_slug", ["slug"])
    .index("by_org", ["orgId"]),
  users: defineTable({
    externalId: v.string(),
    email: v.optional(v.string()),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    role: v.string()
  }).index("by_externalId", ["externalId"]),
  // What the meeting assistant did, so anyone can see what it heard and undo it. Kept two hours.
  assistantEdits: defineTable({
    roomId: v.id("rooms"),
    kind: v.union(v.literal("board"), v.literal("notes"), v.literal("reply"), v.literal("view")),
    heard: v.string(),
    createdAt: v.number(),
    undoneAt: v.optional(v.number()),
    // All edits of one spoken command share this id; undo takes the whole command back.
    commandId: v.optional(v.string()),
    // What the edit did, for the toast: add, connect, change, arrange, delete, show, append, remove.
    action: v.optional(v.string()),
    count: v.optional(v.number()),
    // Elements the assistant added. Undo removes them, and no stale save brings them back.
    elementIds: v.optional(v.array(v.string())),
    // The board it changed. Once another board hangs on the wall, undo leaves that one alone.
    generation: v.optional(v.number()),
    // Elements that were there before and that it changed, moved or deleted: as they were, and as it left them (null: deleted).
    before: v.optional(v.array(v.any())),
    after: v.optional(v.array(v.any())),
    // For each element it deleted, the one that lay on top of it and stayed, so undo puts it back underneath.
    above: v.optional(v.array(v.union(v.string(), v.null()))),
    // A view command for everyone's board: fit, in or out, on these elements (none: the whole board).
    view: v.optional(v.string()),
    focusIds: v.optional(v.array(v.string())),
    blockId: v.optional(v.string()),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
  })
    .index("by_room_created", ["roomId", "createdAt"])
    .index("by_created", ["createdAt"]),
  meetingDocs: defineTable({
    roomId: v.string(),
    contentHtml: v.string(),
    locked: v.boolean(),
    revision: v.optional(v.string()),
    changedAt: v.optional(v.number())
  }).index("by_room", ["roomId"]),
  // The board on the wall: one row per room. Boards it replaced live in whiteboardArchive.
  whiteboardSnapshots: defineTable({
    roomId: v.string(),
    elements: v.array(whiteboardElement),
    name: v.optional(v.string()),
    // When this board was started and last drawn on; both are missing on rows older than sessions.
    boardStartedAt: v.optional(v.number()),
    changedAt: v.optional(v.number()),
    // When this board was put on the wall, by "new board" or by taking a filed one back.
    placedAt: v.optional(v.number()),
    // Counts every time the wall gets a different board, so a save meant for the old one is turned away.
    generation: v.optional(v.number()),
    // Set while the wall is an untouched copy of a filed board; the next stroke clears it.
    sameAsArchiveId: v.optional(v.id("whiteboardArchive"))
  }).index("by_room", ["roomId"]),
  // The room's timer: when it ends, or what is left while it is paused.
  roomTimers: defineTable({
    roomId: v.id("rooms"),
    endsAt: v.optional(v.number()),
    leftMs: v.optional(v.number()),
    totalMs: v.number(),
  }).index("by_room", ["roomId"]),
  // The room's dot vote: every dot cast so far. Only its own dots reach a voter until the result is shown.
  voteRounds: defineTable({
    roomId: v.id("rooms"),
    revealed: v.boolean(),
    votes: v.array(v.object({ voter: v.string(), elementId: v.string() })),
  }).index("by_room", ["roomId"]),
  // A comment thread pinned to one board element. It follows the element by its id, onto filed boards too.
  boardComments: defineTable({
    roomId: v.id("rooms"),
    elementId: v.string(),
    resolved: v.boolean(),
    replies: v.array(v.object({ author: v.string(), name: v.string(), text: v.string(), at: v.number() })),
  }).index("by_room", ["roomId"]),
  // A page of HTML on a board. Kept apart so the board stays small; boards in the history may still show it.
  boardPages: defineTable({
    roomId: v.string(),
    title: v.string(),
    // A page is either HTML a person brought, or an overview (a json-render spec, as JSON) the assistant built.
    html: v.optional(v.string()),
    spec: v.optional(v.string()),
    // Stored by a person but not yet on any board; one that stays so for an hour may make room for others.
    provisional: v.optional(v.boolean()),
  }).index("by_room", ["roomId"]),
  // Filed boards. "replaced": someone started a new board. "session": the board as it stood when a session closed.
  whiteboardArchive: defineTable({
    orgId: v.optional(v.id("organizations")),
    roomId: v.string(),
    elements: v.array(whiteboardElement),
    name: v.optional(v.string()),
    boardStartedAt: v.number(),
    changedAt: v.optional(v.number()),
    filedAt: v.number(),
    reason: v.union(v.literal("replaced"), v.literal("session")),
    sessionId: v.optional(v.id("roomSessions"))
  })
    .index("by_room", ["roomId", "filedAt"])
    .index("by_session", ["sessionId"]),
  // One row per meeting held in a room. Open while people are there; closed once the room stayed empty.
  roomSessions: defineTable({
    orgId: v.optional(v.id("organizations")),
    roomId: v.id("rooms"),
    status: v.union(v.literal("open"), v.literal("closed")),
    startedAt: v.number(),
    // The last moment someone was in the room; it becomes endedAt when the session closes.
    lastActiveAt: v.number(),
    endedAt: v.optional(v.number()),
    participants: v.array(v.object({ userId: v.string(), userName: v.string() })),
    messageCount: v.optional(v.number()),
    // The notes as they stood at the end, kept only when they changed during the session.
    notesHtml: v.optional(v.string()),
    hasBoard: v.optional(v.boolean())
  })
    .index("by_room_status", ["roomId", "status"])
    .index("by_room_started", ["roomId", "startedAt"])
    .index("by_status_active", ["status", "lastActiveAt"]),
  chatMessages: defineTable({
    orgId: v.optional(v.id("organizations")),
    roomId: v.string(),
    userId: v.string(),
    userName: v.string(),
    // Empty when the message is only an image or a GIF.
    text: v.string(),
    timestamp: v.number(),
    attachment: v.optional(v.union(
      v.object({ kind: v.literal("image"), storageId: v.id("_storage"), width: v.number(), height: v.number() }),
      v.object({ kind: v.literal("gif"), url: v.string(), width: v.number(), height: v.number(), title: v.optional(v.string()) })
    ))
  }).index("by_room", ["roomId"]),
  // Images uploaded for the chat, bound to room and uploader so a message can only carry its sender's own file.
  chatUploads: defineTable({
    roomId: v.string(),
    uploaderId: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    size: v.number(),
    createdAt: v.number(),
    messageId: v.optional(v.id("chatMessages")),
    // An image pasted onto a whiteboard: no message takes it, and boards in the history may still show it.
    keptFor: v.optional(v.literal("board")),
  }).index("by_message_created", ["messageId", "createdAt"])
    .index("by_orphan", ["messageId", "keptFor", "createdAt"])
    .index("by_room", ["roomId"]),
  chatReactions: defineTable({
    roomId: v.string(),
    messageId: v.id("chatMessages"),
    userId: v.string(),
    emoji: v.string()
  }).index("by_message", ["messageId"]),
  recordings: defineTable({
    orgId: v.optional(v.id("organizations")),
    roomId: v.id("rooms"),
    egressId: v.optional(v.string()),
    status: v.string(), // "starting" | "recording" | "completed" | "failed"
    startedAt: v.number(),
    stoppedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    storagePath: v.optional(v.string()),
    startedByUserId: v.string()
  })
    .index("by_org", ["orgId", "startedAt"])
    .index("by_room", ["roomId", "startedAt"])
    .index("by_status", ["status"])
    .index("by_egress", ["egressId"]),
  transcripts: defineTable({
    recordingId: v.id("recordings"),
    status: v.string(), // "processing" | "completed" | "failed"
    text: v.optional(v.string()),
    segments: v.optional(
      v.array(
        v.object({
          startMs: v.number(),
          endMs: v.number(),
          speaker: v.number(),
          text: v.string(),
        }),
      ),
    ),
    provider: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_recording", ["recordingId"]),
  subscriptions: defineTable({
    orgId: v.id("organizations"),
    planId: v.string(), // "free" | "pro" | "business"
    status: v.string(), // "active" | "past_due" | "canceled"
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    recordingMinutesUsed: v.number()
  }).index("by_org", ["orgId"]),
  memberships: defineTable({
    orgId: v.optional(v.id("organizations")),
    roomId: v.id("rooms"),
    userId: v.string(),
    role: v.string(),
    createdAt: v.number()
  })
    .index("by_room_user", ["roomId", "userId"])
    .index("by_user", ["userId"]),
  roomPresence: defineTable({
    roomId: v.id("rooms"),
    userId: v.string(),
    userName: v.string(),
    handRaised: v.boolean(),
    lastSeen: v.number()
  })
    .index("by_room_user", ["roomId", "userId"])
    .index("by_room", ["roomId"]),
  // Proof that a participant passed the join gate. Queries and mutations cannot
  // verify the LiveKit-signed session credential, so they check this instead.
  roomAccessGrants: defineTable({
    roomId: v.id("rooms"),
    identity: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number()
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_room", ["roomId"]),
  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    createdAt: v.number()
  }).index("by_slug", ["slug"]),
  // Keys for the REST API (`/v1`). Each acts for its workspace; only the SHA-256 of the key is kept.
  apiKeys: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    prefix: v.string(),
    tokenHash: v.string(),
    createdByUserId: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number())
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_org", ["orgId"]),
  orgMemberships: defineTable({
    orgId: v.id("organizations"),
    userId: v.string(),
    role: v.string(),
    createdAt: v.number()
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"]),
  breakoutSessions: defineTable({
    parentRoomId: v.id("rooms"),
    generation: v.number(),
    status: v.union(v.literal("active"), v.literal("ended")),
    rooms: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        livekitRoomName: v.string(),
      }),
    ),
    assignments: v.array(
      v.object({
        identity: v.string(),
        name: v.string(),
        roomId: v.string(),
      }),
    ),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_parent", ["parentRoomId"])
    .index("by_parent_status", ["parentRoomId", "status"]),
  deviceHandoffs: defineTable({
    roomId: v.id("rooms"),
    roomSlug: v.string(),
    identity: v.string(),
    name: v.string(),
    role: v.string(),
    secretHash: v.string(),
    status: v.union(v.literal("pending"), v.literal("redeemed"), v.literal("cancelled"), v.literal("expired")),
    breakoutRoomId: v.string(),
    breakoutGeneration: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    redeemedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
  })
    .index("by_room_identity_status", ["roomId", "identity", "status"])
    .index("by_expires", ["expiresAt"]),
})
