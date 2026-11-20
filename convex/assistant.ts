import { ConvexError, v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { checkAssistantRateLimit } from "./lib/rateLimit"
import { findRoomAccessGrant, getRoomOrThrow, requireRoomResourceAccess } from "./lib/roomAccess"
import { toRoomIdentity } from "./lib/roomIdentity"
import { sanitizeHtml } from "./lib/sanitization"
import { validateMeetingDoc } from "./lib/validation"
import { ASSISTANT_IDENTITY_PREFIX, EDIT_KEEP_MS, onWall, recentEdits, removeBlock, sameElement, type AssistantEdit } from "./lib/assistantEdits"
import { getWall, MAX_ELEMENTS, storePage, validateWhiteboardElements, writeWall } from "./whiteboard"
import { boxOf, dockArrow, layoutBlock, placeBlock, pointOn } from "./lib/boardLayout"
import { addMindmapNode, followBindings, layoutMindmap } from "../src/components/whiteboard/operations"
import { moveElement } from "../src/components/whiteboard/geometry"
import { lineHeightFor, mindmapNodeSize } from "../src/components/whiteboard/draw"

const requireAssistantGrant = async (ctx: any, roomId: string, accessToken: string) => {
  const grant = await findRoomAccessGrant(ctx, roomId, accessToken)
  if (!grant || !String(grant.identity).startsWith(ASSISTANT_IDENTITY_PREFIX)) {
    throw new ConvexError("Only the room's assistant can do this")
  }
}

const requireAssistant = async (ctx: any, roomId: string, accessToken: string) => {
  await requireAssistantGrant(ctx, roomId, accessToken)
  await checkAssistantRateLimit(ctx, roomId)
}

const newId = () => crypto.randomUUID()

const MAX_HEARD = 500
const heardArg = v.string()
const clip = (text: string, max: number) => text.trim().slice(0, max)

// --- Board ---

const STICKY_FILLS: Record<string, string> = {
  yellow: "#fbe7b0",
  green: "#d4edd9",
  blue: "#d6e6fb",
  pink: "#f9d9d9",
  violet: "#e6dcf7",
}
// The board's own inks (src/components/whiteboard/StylePanel.tsx); colours without an ink take the nearest one.
const INKS: Record<string, string> = {
  black: "#18181b",
  red: "#dc2626",
  orange: "#ea580c",
  green: "#16a34a",
  blue: "#2563eb",
  violet: "#7c3aed",
  pink: "#dc2626",
  yellow: "#ea580c",
}
const INK = INKS.black
/** The name its notes are signed with, as people call it. */
const ASSISTANT_NAME = "Vivo"
const colorName = v.optional(v.union(...["yellow", "green", "blue", "pink", "violet", "red", "orange", "black"].map(c => v.literal(c))))

const SIZES = {
  sticky: { width: 200, height: 200 },
  rectangle: { width: 220, height: 120 },
  circle: { width: 150, height: 150 },
  diamond: { width: 200, height: 150 },
}
const TEXT_SIZE = 20
const MAX_ITEMS = 12
const MAX_LINKS = 20
const MAX_TOUCHED = 100

type Kind = "sticky" | "rectangle" | "circle" | "diamond" | "text"
type BoardItem = { key?: string; kind: Kind; text?: string; color?: string }

const kindArg = v.union(v.literal("sticky"), v.literal("rectangle"), v.literal("circle"), v.literal("diamond"), v.literal("text"))
const layoutArg = v.optional(v.union(v.literal("row"), v.literal("column"), v.literal("grid")))
const sideArg = v.optional(v.union(v.literal("right"), v.literal("left"), v.literal("below"), v.literal("above")))
const linksArg = v.array(v.object({ from: v.string(), to: v.string() }))
const commandArg = v.optional(v.string())

/** Free text has no canvas here to measure it: about half a font size per character is close enough to select it. */
const textSize = (text: string, fontSize = TEXT_SIZE) => {
  const lines = text.split("\n")
  return { width: Math.ceil(Math.max(...lines.map(l => l.length), 1) * fontSize * 0.55), height: lines.length * lineHeightFor(fontSize) }
}

const sizeOf = (item: BoardItem) => (item.kind === "text" ? textSize(item.text?.trim() || " ") : SIZES[item.kind])

const toElement = (item: BoardItem, at: { x: number; y: number }) => {
  const text = item.text?.trim()
  const common = { id: newId(), ...at, author: "assistant" }
  if (item.kind === "text") {
    if (!text) throw new ConvexError("Text needs words")
    return { ...common, type: "text", ...textSize(text), text, color: INKS[item.color ?? "black"] ?? INK, fontSize: TEXT_SIZE }
  }
  const sticky = item.kind === "sticky"
  return {
    ...common,
    type: "shape",
    shapeType: sticky ? "note" : item.kind,
    ...(sticky ? { by: ASSISTANT_NAME } : {}),
    ...SIZES[item.kind],
    strokeColor: sticky ? "transparent" : INKS[item.color ?? "black"] ?? INK,
    fillColor: sticky ? STICKY_FILLS[item.color ?? "yellow"] ?? STICKY_FILLS.yellow : "transparent",
    strokeWidth: sticky ? 0 : 2,
    ...(text ? { text } : {}),
  }
}

/** What takes room on the board. A section is an area to put things on, and a stamp sits on something else. */
const takesRoom = (el: any) => el.type !== "line" && el.type !== "stamp" && el.shapeType !== "section"

/** The boxes an arrow between these two should not cross: everything else that takes room. */
const inTheWay = (elements: any[], ...ends: string[]) =>
  elements.filter(el => takesRoom(el) && !ends.includes(el.id)).map(boxOf)

const arrow = (from: any, to: any, elements: any[]) => {
  const a = boxOf(from), b = boxOf(to)
  const dock = dockArrow(a, b, inTheWay(elements, from.id, to.id))
  return {
    id: newId(),
    type: "line",
    points: [pointOn(a, dock.start), pointOn(b, dock.end)],
    strokeColor: INK,
    strokeWidth: 2,
    endArrow: true,
    start: { id: from.id, ...dock.start },
    end: { id: to.id, ...dock.end },
    author: "assistant",
  }
}

/** Stored form: fields left undefined by a change are gone, as the database keeps them. */
const clean = (el: any) => JSON.parse(JSON.stringify(el))

/** Bound arrow ends and stamps back on their elements; a stamp whose element went goes too. Unchanged ones stay as they are. */
const withArrowsFollowing = (elements: any[]) => {
  const was = new Map(elements.map(el => [el.id, el]))
  return followBindings(elements).map(el => (el === was.get(el.id) ? el : clean(el)))
}

const pick = (elements: any[], ids: string[]) => {
  const byId = new Map(elements.map(el => [el.id, el]))
  const missing = ids.filter(id => !byId.has(id))
  if (missing.length) throw new ConvexError(`Not on the board: ${missing.join(", ")}`)
  return ids.map(id => byId.get(id))
}

type EditMeta = { roomId: string; heard: string; commandId?: string; action: string; count: number }

/**
 * Writes a new state of the board as one of the assistant's edits. What it added, and what it changed or
 * deleted of what was there (as it was and as it is now), is kept for undo and for stale clients.
 */
const commitBoard = async (ctx: any, wall: any, current: any[], next: any[], meta: EditMeta) => {
  const now = new Map(current.map(el => [el.id, el]))
  const nextIds = new Set(next.map(el => el.id))
  const before: any[] = [], after: any[] = [], above: (string | null)[] = []
  current.forEach((el, i) => {
    if (nextIds.has(el.id)) return
    before.push(el)
    after.push(null)
    // What lay on top of it and stays: undo puts it back underneath.
    above.push(current.slice(i + 1).find(other => nextIds.has(other.id))?.id ?? null)
  })
  for (const el of next) {
    const old = now.get(el.id)
    if (old && old !== el && !sameElement(old, el)) { before.push(old); after.push(el); above.push(null) }
  }
  const added = next.filter(el => !now.has(el.id))
  validateWhiteboardElements([...added, ...after.filter(Boolean)])
  if (next.length > MAX_ELEMENTS) throw new ConvexError("The board is full (max 10,000 elements)")
  if (before.length > MAX_TOUCHED || JSON.stringify(before).length > 300_000) {
    throw new ConvexError("That is too much to change at once")
  }
  const generation = await writeWall(ctx, meta.roomId, wall, next)
  return await ctx.db.insert("assistantEdits", {
    roomId: meta.roomId,
    kind: "board",
    heard: clip(meta.heard, MAX_HEARD),
    ...(meta.commandId ? { commandId: meta.commandId } : {}),
    action: meta.action,
    count: meta.count,
    elementIds: added.map(el => el.id),
    generation,
    ...(before.length ? { before, after, above } : {}),
    createdAt: Date.now(),
  })
}

const boardOf = async (ctx: any, roomId: string) => {
  const wall = await getWall(ctx, roomId)
  return { wall, current: (wall?.elements ?? []) as any[] }
}

/** Arrows between existing elements and keys of new ones, appended after everything else. */
const linkUp = (elements: any[], links: { from: string; to: string }[], keys: Record<string, string> = {}) => {
  if (links.length > MAX_LINKS) throw new ConvexError(`At most ${MAX_LINKS} arrows at a time`)
  const ids = (ref: string) => keys[ref] ?? ref
  return links.map(link => {
    const [from, to] = pick(elements, [ids(link.from), ids(link.to)])
    if (from.type === "line" || to.type === "line") throw new ConvexError("Arrows join shapes, notes and text, not other arrows")
    return arrow(from, to, elements)
  })
}

const meta = (args: { roomId: string; heard: string; commandId?: string }, action: string, count: number): EditMeta =>
  ({ roomId: args.roomId, heard: args.heard, commandId: args.commandId, action, count })

/**
 * Notes, boxes, circles, diamonds and text. Laid out as one block (row, column or grid) beside an
 * element it names, or in free space among what is there; joined by arrows if asked.
 */
export const addToBoard = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.string(),
    heard: heardArg,
    commandId: commandArg,
    items: v.array(v.object({ key: v.optional(v.string()), kind: kindArg, text: v.optional(v.string()), color: colorName })),
    links: v.optional(linksArg),
    layout: layoutArg,
    near: v.optional(v.string()),
    side: sideArg,
  },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    if (args.items.length === 0 || args.items.length > MAX_ITEMS) {
      throw new ConvexError(`Between 1 and ${MAX_ITEMS} things at a time`)
    }
    const { wall, current } = await boardOf(ctx, args.roomId)
    const block = layoutBlock(args.items.map(sizeOf), args.layout)
    const anchor = args.near ? { box: boxOf(pick(current, [args.near])[0]), side: args.side ?? "right" as const } : undefined
    const origin = placeBlock(current.filter(takesRoom).map(boxOf), block, anchor)
    const added = args.items.map((item, i) => toElement(item, { x: origin.x + block.offsets[i].x, y: origin.y + block.offsets[i].y }))
    const keys = Object.fromEntries(args.items.map((item, i) => [item.key ?? String(i), added[i].id]))
    const arrows = linkUp([...current, ...added], args.links ?? [], keys)
    const editId = await commitBoard(ctx, wall, current, [...current, ...added, ...arrows], meta(args, "add", added.length))
    return { editId, count: added.length, ids: keys }
  },
})

export const TASK_SIZE = { width: 280, height: 150 }

/** Tasks someone said out loud, as task cards in a column beside what is there. */
export const addTasksToBoard = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.string(),
    heard: heardArg,
    commandId: commandArg,
    tasks: v.array(v.object({ text: v.string(), owner: v.optional(v.string()), due: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const tasks = args.tasks.filter(task => task.text.trim())
    if (tasks.length === 0 || tasks.length > MAX_ITEMS) throw new ConvexError(`Between 1 and ${MAX_ITEMS} tasks at a time`)
    const { wall, current } = await boardOf(ctx, args.roomId)
    const block = layoutBlock(tasks.map(() => TASK_SIZE), "column")
    const origin = placeBlock(current.filter(takesRoom).map(boxOf), block)
    const added = tasks.map((task, i) => ({
      id: newId(), type: "shape", shapeType: "task", x: origin.x + block.offsets[i].x, y: origin.y + block.offsets[i].y, ...TASK_SIZE,
      text: clip(task.text, 200), strokeColor: "transparent", fillColor: "#ffffff", strokeWidth: 0, author: "assistant", by: ASSISTANT_NAME,
      ...(task.owner?.trim() ? { owner: clip(task.owner, 60) } : {}),
      ...(task.due ? { due: task.due } : {}),
    }))
    const editId = await commitBoard(ctx, wall, current, [...current, ...added], meta(args, "tasks", added.length))
    return { editId, ids: added.map(el => el.id) }
  },
})

const MINDMAP_FONT = 16
/** No canvas here either: the same estimate as free text, so a node is about as wide as its words. */
const nodeSize = (text: string, fontSize = MINDMAP_FONT) => mindmapNodeSize(text, fontSize, run => run.length * fontSize * 0.55)

/** Ideas someone said, as branches of a mind map: under a node already there, or around a new topic. */
export const addBranchesToBoard = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.string(),
    heard: heardArg,
    commandId: commandArg,
    under: v.optional(v.string()),
    topic: v.optional(v.string()),
    branches: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const branches = args.branches.map(text => clip(text, 200)).filter(Boolean)
    if (branches.length > MAX_ITEMS) throw new ConvexError(`At most ${MAX_ITEMS} branches at a time`)
    const { wall, current } = await boardOf(ctx, args.roomId)
    let next = current
    let under = args.under
    const added: string[] = []
    if (under) {
      if (!current.some(el => el.id === under && el.shapeType === "mindmap")) throw new ConvexError("Branches go under a node of a mind map")
    } else {
      const topic = clip(args.topic ?? "", 200)
      if (!topic) throw new ConvexError("A new mind map needs a topic")
      const size = nodeSize(topic)
      const room = { width: size.width + 56 + 320, height: Math.max(size.height, branches.length * 56) }
      const at = placeBlock(current.filter(takesRoom).map(boxOf), room)
      const root = {
        id: newId(), type: "shape", shapeType: "mindmap", x: at.x, y: at.y + (room.height - size.height) / 2, ...size,
        text: topic, strokeColor: "#18181b", fillColor: "#ffffff", strokeWidth: 2, author: "assistant", by: ASSISTANT_NAME,
      }
      next = [...current, root]
      under = root.id
      added.push(root.id)
    }
    for (const text of branches) {
      const grown = addMindmapNode(next, under, "child", ASSISTANT_NAME)
      // A branch takes on the size of the node it hangs from; measured at that size, its words fit.
      next = grown.elements.map(el => (el.id === grown.added ? { ...el, ...nodeSize(text, (el as { fontSize?: number }).fontSize ?? MINDMAP_FONT), text, author: "assistant" } : el))
      added.push(grown.added)
    }
    if (added.length === 0) throw new ConvexError("Nothing to add to the mind map")
    next = layoutMindmap(next, under)
    const editId = await commitBoard(ctx, wall, current, next, meta(args, "mindmap", added.length))
    return { editId, ids: added }
  },
})

/** An overview the assistant built from the board's own parts (a json-render spec); placed like everything else it adds. */
export const addViewToBoard = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.string(),
    heard: heardArg,
    commandId: commandArg,
    title: v.string(),
    spec: v.any(),
    near: v.optional(v.string()),
    side: sideArg,
  },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const { wall, current } = await boardOf(ctx, args.roomId)
    const size = { width: 640, height: 480 }
    const anchor = args.near ? { box: boxOf(pick(current, [args.near])[0]), side: args.side ?? "right" as const } : undefined
    const at = placeBlock(current.filter(takesRoom).map(boxOf), size, anchor)
    const page = await storePage(ctx, args.roomId, args.title, { spec: args.spec })
    const added = { id: newId(), type: "html", page, title: clip(args.title, 120), ...at, ...size, author: "assistant" }
    const editId = await commitBoard(ctx, wall, current, [...current, added], meta(args, "overview", 1))
    return { editId, id: added.id }
  },
})

export const connectOnBoard = mutation({
  args: { roomId: v.id("rooms"), accessToken: v.string(), heard: heardArg, commandId: commandArg, links: linksArg },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    if (args.links.length === 0) throw new ConvexError("Nothing to join")
    const { wall, current } = await boardOf(ctx, args.roomId)
    const arrows = linkUp(current, args.links)
    const editId = await commitBoard(ctx, wall, current, [...current, ...arrows], meta(args, "connect", arrows.length))
    return { editId, ids: arrows.map(a => a.id) }
  },
})

/** New text or colour. A filled shape takes the colour as its fill; everything else as its line or letters. */
export const changeOnBoard = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.string(),
    heard: heardArg,
    commandId: commandArg,
    changes: v.array(v.object({ id: v.string(), text: v.optional(v.string()), color: colorName })),
  },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const { wall, current } = await boardOf(ctx, args.roomId)
    const wanted = new Map(args.changes.map(c => [c.id, c]))
    pick(current, [...wanted.keys()])
    // Mind maps whose nodes got new words are laid out again, so the grown node has room.
    const relaid: string[] = []
    let changed = current.map(el => {
      const change = wanted.get(el.id)
      if (!change) return el
      const out = { ...el }
      if (change.text !== undefined) {
        if (el.type !== "shape" && el.type !== "text") throw new ConvexError("Only shapes, notes and text hold words")
        const text = change.text.trim()
        if (text) out.text = text
        else if (el.type === "text") throw new ConvexError("Text needs words")
        // A node without words is a branch someone took away; taking one away is deleting it.
        else if (el.shapeType === "mindmap") throw new ConvexError("A mind map node needs words")
        else delete out.text
        if (el.type === "text" && text) {
          const size = textSize(text, el.fontSize ?? TEXT_SIZE)
          Object.assign(out, size, { width: Math.max(el.width, size.width) })
        }
        if (el.shapeType === "mindmap") {
          Object.assign(out, nodeSize(text, el.fontSize ?? MINDMAP_FONT))
          relaid.push(el.id)
        }
      }
      if (change.color) {
        const filled = el.type === "shape" && el.fillColor !== "transparent"
        if (filled) out.fillColor = STICKY_FILLS[change.color] ?? INKS[change.color]
        else if (el.type === "shape" || el.type === "line") out.strokeColor = INKS[change.color]
        else out.color = INKS[change.color]
      }
      return out
    })
    for (const id of relaid) changed = layoutMindmap(changed, id)
    // A text that grew with its words takes the arrows and stamps on it along.
    const next = withArrowsFollowing(changed)
    const editId = await commitBoard(ctx, wall, current, next, meta(args, "change", args.changes.length))
    return { editId }
  },
})

/**
 * Moves elements as one block: beside another element, or laid out anew where they are. Arrows bound to
 * them follow; arrows themselves are not moved, they hang on what they join.
 */
export const arrangeOnBoard = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.string(),
    heard: heardArg,
    commandId: commandArg,
    ids: v.array(v.string()),
    layout: layoutArg,
    near: v.optional(v.string()),
    side: sideArg,
  },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const { wall, current } = await boardOf(ctx, args.roomId)
    const chosen = pick(current, args.ids).filter(el => el.type !== "line")
    if (chosen.length === 0) throw new ConvexError("Nothing to move")
    const moving = new Set(chosen.map(el => el.id))
    const boxes = chosen.map(boxOf)
    let offsets: { x: number; y: number }[]
    let size: { width: number; height: number }
    if (args.layout || chosen.length === 1) {
      const block = layoutBlock(boxes, args.layout ?? "row")
      offsets = block.offsets
      size = block
    } else {
      // Kept as they are to each other, moved as a whole.
      const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y))
      offsets = boxes.map(b => ({ x: b.x - left, y: b.y - top }))
      size = { width: Math.max(...boxes.map(b => b.x + b.width)) - left, height: Math.max(...boxes.map(b => b.y + b.height)) - top }
    }
    let origin = { x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)) }
    if (args.near) {
      if (moving.has(args.near)) throw new ConvexError("An element cannot move next to itself")
      const anchor = { box: boxOf(pick(current, [args.near])[0]), side: args.side ?? "right" as const }
      const others = current.filter(el => !moving.has(el.id) && takesRoom(el)).map(boxOf)
      origin = placeBlock(others, size, anchor)
    }
    const target = new Map(chosen.map((el, i) => [el.id, { dx: origin.x + offsets[i].x - boxes[i].x, dy: origin.y + offsets[i].y - boxes[i].y }]))
    const moved = current.map(el => {
      const by = target.get(el.id)
      return by && (by.dx || by.dy) ? clean(moveElement(el, by.dx, by.dy)) : el
    })
    // Arrows to what moved dock anew, on the edges that face each other now.
    const byId = new Map(moved.map(el => [el.id, el]))
    const redocked = moved.map(el => {
      const from = byId.get(el.start?.id), to = byId.get(el.end?.id)
      if (el.type !== "line" || !from || !to || !(moving.has(from.id) || moving.has(to.id))) return el
      const dock = dockArrow(boxOf(from), boxOf(to), inTheWay(moved, from.id, to.id))
      return { ...el, start: { ...el.start, ...dock.start }, end: { ...el.end, ...dock.end } }
    })
    const next = withArrowsFollowing(redocked)
    const editId = await commitBoard(ctx, wall, current, next, meta(args, "arrange", chosen.length))
    return { editId }
  },
})

export const deleteFromBoard = mutation({
  args: { roomId: v.id("rooms"), accessToken: v.string(), heard: heardArg, commandId: commandArg, ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const { wall, current } = await boardOf(ctx, args.roomId)
    const gone = new Set(pick(current, args.ids).map(el => el.id))
    // Arrows whose ends were bound to what went keep their place and let go.
    const next = withArrowsFollowing(current.filter(el => !gone.has(el.id)))
    const editId = await commitBoard(ctx, wall, current, next, meta(args, "delete", gone.size))
    return { editId }
  },
})

/** Everyone who has the board open sees these elements, or the whole board, or a step closer or further. */
export const showOnBoard = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.string(),
    heard: heardArg,
    commandId: commandArg,
    ids: v.optional(v.array(v.string())),
    mode: v.union(v.literal("fit"), v.literal("in"), v.literal("out")),
  },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const { current } = await boardOf(ctx, args.roomId)
    const ids = args.ids?.length ? pick(current, args.ids).map(el => el.id) : []
    const editId = await ctx.db.insert("assistantEdits", {
      roomId: args.roomId,
      kind: "view",
      heard: clip(args.heard, MAX_HEARD),
      ...(args.commandId ? { commandId: args.commandId } : {}),
      action: "show",
      view: args.mode,
      focusIds: ids,
      createdAt: Date.now(),
    })
    return { editId }
  },
})

/** The board and the notes as the assistant reads them before it acts: boxes and words, never pen points or image data. */
export const context = query({
  args: { roomId: v.id("rooms"), accessToken: v.string() },
  handler: async (ctx, args) => {
    await requireAssistantGrant(ctx, args.roomId, args.accessToken)
    const { current } = await boardOf(ctx, args.roomId)
    const doc = await ctx.db.query("meetingDocs").withIndex("by_room", q => q.eq("roomId", args.roomId)).first()
    return { board: current.map(describe), notesHtml: doc?.contentHtml ?? "", notesLocked: doc?.locked ?? false }
  },
})

const describe = (el: any) => {
  const b = boxOf(el)
  const box = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
  const extra = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  if (el.type === "stroke") return { id: el.id, type: "stroke", ...box, color: el.color }
  if (el.type === "image") return { id: el.id, type: "image", ...box }
  if (el.type === "html") return { id: el.id, type: "html", ...box, title: el.title }
  if (el.type === "line") {
    return { id: el.id, type: "line", ...box, ...extra({ color: el.strokeColor, from: el.start?.id, to: el.end?.id, arrow: el.endArrow || el.startArrow || undefined, groupId: el.groupId }) }
  }
  if (el.type === "text") return { id: el.id, type: "text", ...box, ...extra({ text: el.text, color: el.color, groupId: el.groupId }) }
  if (el.type === "stamp") return { id: el.id, type: "stamp", ...box, stamp: el.stamp, ...extra({ on: el.on?.id, by: el.by }) }
  return {
    id: el.id, type: "shape", shapeType: el.shapeType ?? (el.type === "circle" ? "circle" : "rectangle"), ...box,
    ...extra({ text: el.text, fill: el.fillColor, color: el.strokeColor, by: el.by, groupId: el.groupId, author: el.author }),
    ...(el.shapeType === "task" ? extra({ owner: el.owner, due: el.due, done: !!el.done }) : {}),
    ...extra({ cells: el.cells, parent: el.parent }),
  }
}

// --- Notes ---

const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The block is built here from plain text; nothing the model says is ever taken as HTML. */
const buildBlock = (blockId: string, parts: { heading?: string; paragraphs?: string[]; bullets?: string[] }) => {
  const mark = `data-assistant="${blockId}"`
  const lines = (list?: string[]) => (list ?? []).map(line => line.trim()).filter(Boolean)
  let html = ""
  if (parts.heading?.trim()) html += `<h3 ${mark}>${escapeText(clip(parts.heading, 120))}</h3>`
  for (const paragraph of lines(parts.paragraphs).slice(0, 10)) html += `<p ${mark}>${escapeText(clip(paragraph, 1000))}</p>`
  const bullets = lines(parts.bullets).slice(0, 20)
  if (bullets.length) html += `<ul ${mark}>${bullets.map(b => `<li><p>${escapeText(clip(b, 300))}</p></li>`).join("")}</ul>`
  return html
}

export const appendToNotes = mutation({
  args: {
    roomId: v.id("rooms"),
    accessToken: v.string(),
    heard: heardArg,
    commandId: commandArg,
    heading: v.optional(v.string()),
    paragraphs: v.optional(v.array(v.string())),
    bullets: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const doc = await ctx.db.query("meetingDocs").withIndex("by_room", q => q.eq("roomId", args.roomId)).first()
    if (doc?.locked) throw new ConvexError("The notes are locked")

    const blockId = `blk-${newId()}`
    const block = sanitizeHtml(buildBlock(blockId, args))
    if (!block) throw new ConvexError("Nothing to write")
    const contentHtml = (doc?.contentHtml ?? "") + block
    validateMeetingDoc(contentHtml)
    if (doc) await ctx.db.patch(doc._id, { contentHtml, changedAt: Date.now() })
    else await ctx.db.insert("meetingDocs", { roomId: args.roomId, contentHtml, locked: false, changedAt: Date.now() })

    const editId = await ctx.db.insert("assistantEdits", {
      roomId: args.roomId,
      kind: "notes",
      heard: clip(args.heard, MAX_HEARD),
      ...(args.commandId ? { commandId: args.commandId } : {}),
      action: "append",
      blockId,
      html: block,
      createdAt: Date.now(),
    })
    return { editId, blockId, count: (args.bullets?.length ?? 0) + (args.paragraphs?.length ?? 0) + (args.heading ? 1 : 0) }
  },
})

/**
 * Takes out blocks it wrote itself. Open editors take a block out when its edit is undone, so that is how
 * this works; what people wrote it never touches, since their editors would not take that change.
 */
export const removeFromNotes = mutation({
  args: { roomId: v.id("rooms"), accessToken: v.string(), heard: heardArg, commandId: commandArg, blockIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const doc = await ctx.db.query("meetingDocs").withIndex("by_room", q => q.eq("roomId", args.roomId)).first()
    if (doc?.locked) throw new ConvexError("The notes are locked")
    const edits = await recentEdits(ctx, args.roomId)
    const own = args.blockIds.map(id => edits.find(e => e.kind === "notes" && e.blockId === id && !e.undoneAt))
    if (own.length === 0 || own.some(e => !e)) throw new ConvexError("Only blocks the assistant wrote in the last two hours can be taken out")
    let html = doc?.contentHtml ?? ""
    for (const edit of own as AssistantEdit[]) {
      html = removeBlock(html, edit.blockId!)
      await ctx.db.patch(edit._id as Id<"assistantEdits">, { undoneAt: Date.now() })
    }
    if (doc) await ctx.db.patch(doc._id, { contentHtml: html, changedAt: Date.now() })
    const editId = await ctx.db.insert("assistantEdits", {
      roomId: args.roomId,
      kind: "notes",
      heard: clip(args.heard, MAX_HEARD),
      ...(args.commandId ? { commandId: args.commandId } : {}),
      action: "remove",
      count: own.length,
      createdAt: Date.now(),
    })
    return { editId }
  },
})

// --- Replies and undo ---

export const reply = mutation({
  args: { roomId: v.id("rooms"), accessToken: v.string(), heard: heardArg, commandId: commandArg, text: v.string() },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const editId = await ctx.db.insert("assistantEdits", {
      roomId: args.roomId,
      kind: "reply",
      heard: clip(args.heard, MAX_HEARD),
      ...(args.commandId ? { commandId: args.commandId } : {}),
      text: clip(args.text, 500),
      createdAt: Date.now(),
    })
    return { editId }
  },
})

/** The generation of the board on the wall now. */
const wallGeneration = async (ctx: any, roomId: string) => (await getWall(ctx, roomId))?.generation ?? 0


/**
 * What undo can take back. Replies, views and removals change nothing that undo could put back.
 * A command goes back whole or not at all: once a new or restored board has replaced the board
 * one of its changes was made on, none of it can be undone.
 */
const undoableIn = (edits: AssistantEdit[], generation: number) => {
  const stranded = new Set(edits.filter(e => !e.undoneAt && !onWall(e, generation)).map(e => e.commandId ?? e._id))
  return (edit: AssistantEdit) =>
    !edit.undoneAt && !stranded.has(edit.commandId ?? edit._id)
    && (edit.kind === "board" || (edit.kind === "notes" && edit.action !== "remove"))
}

const undoEdit = async (ctx: any, edit: AssistantEdit) => {
  if (edit.kind === "board") {
    const wall = await getWall(ctx, edit.roomId)
    const added = new Set(edit.elementIds ?? [])
    let elements: any[] = (wall?.elements ?? []).filter((el: any) => !added.has(el.id))
    // What it changed goes back, unless someone changed it since; what it deleted comes back.
    ;(edit.before ?? []).forEach((old, i) => {
      const now = edit.after?.[i] ?? null
      const at = elements.findIndex(el => el.id === old.id)
      if (now === null) {
        if (at >= 0) return
        const under = elements.findIndex(el => el.id === edit.above?.[i])
        elements = under < 0 ? [...elements, old] : [...elements.slice(0, under), old, ...elements.slice(under)]
      }
      else if (at >= 0 && sameElement(elements[at], now)) elements = elements.map((el, j) => (j === at ? old : el))
    })
    // Arrows and stamps people attached since then follow what went back; on what went away they let go.
    if (wall) await writeWall(ctx, edit.roomId, wall, withArrowsFollowing(elements))
  } else {
    const doc = await ctx.db.query("meetingDocs").withIndex("by_room", (q: any) => q.eq("roomId", edit.roomId)).first()
    if (doc) await ctx.db.patch(doc._id, { contentHtml: removeBlock(doc.contentHtml, edit.blockId!), changedAt: Date.now() })
  }
  await ctx.db.patch(edit._id, { undoneAt: Date.now() })
}

/** Everything one spoken command did, newest first, so changes to the same element unwind in order. */
const undoCommand = async (ctx: any, edit: AssistantEdit) => {
  const group = edit.commandId
    ? (await recentEdits(ctx, edit.roomId)).filter(e => e.commandId === edit.commandId)
    : [edit]
  const undoable = group.filter(undoableIn(group, await wallGeneration(ctx, edit.roomId)))
  if (undoable.length === 0) throw new ConvexError("This cannot be undone")
  for (const e of undoable) await undoEdit(ctx, e)
  // What it deleted comes back onto a board people may have filled since; the throw takes the whole undo back.
  if (((await getWall(ctx, edit.roomId))?.elements.length ?? 0) > MAX_ELEMENTS) {
    throw new ConvexError("The board is full (max 10,000 elements)")
  }
  return undoable[0]
}

/** Anyone in the room can take back what the assistant did, from the note it shows. */
export const undo = mutation({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()), editId: v.id("assistantEdits") },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const edit = (await ctx.db.get(args.editId)) as AssistantEdit | null
    if (!edit || edit.roomId !== args.roomId) throw new ConvexError("Not found")
    await undoCommand(ctx, edit)
  },
})

/** "Vivo, mach das rückgängig": the newest command whose changes still stand. */
export const undoLast = mutation({
  args: { roomId: v.id("rooms"), accessToken: v.string(), heard: heardArg, commandId: commandArg },
  handler: async (ctx, args) => {
    await requireAssistant(ctx, args.roomId, args.accessToken)
    const edits = await recentEdits(ctx, args.roomId)
    const canUndo = undoableIn(edits, await wallGeneration(ctx, args.roomId))
    const edit = edits.find(e => canUndo(e) && (!args.commandId || e.commandId !== args.commandId))
    if (!edit) throw new ConvexError("Nothing to undo")
    const undone = await undoCommand(ctx, edit)
    return { kind: undone.kind }
  },
})

export const recent = query({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const edits = await recentEdits(ctx, args.roomId)
    const canUndo = undoableIn(edits, await wallGeneration(ctx, args.roomId))
    // The overlay needs the newest twenty. Open editors also need every block the assistant still keeps
    // a record of, so that one taken out later disappears from them too.
    const listed = edits.filter((edit, i) => i < 20 || (edit.kind === "notes" && edit.blockId))
    return listed.map(edit => ({
      id: edit._id,
      kind: edit.kind,
      heard: edit.heard,
      createdAt: edit.createdAt,
      undoneAt: edit.undoneAt ?? null,
      commandId: edit.commandId ?? null,
      action: edit.action ?? (edit.kind === "board" ? "add" : edit.kind === "notes" ? "append" : null),
      count: edit.count ?? (edit.kind === "board" ? edit.elementIds?.length ?? 0 : undefined),
      // What a board should bring into view: the new elements and those it changed and left there.
      focusIds: edit.kind === "view" ? edit.focusIds ?? [] : edit.kind === "board"
        ? [...(edit.elementIds ?? []), ...(edit.after ?? []).filter(Boolean).map((el: any) => el.id)]
        : [],
      view: edit.view ?? null,
      canUndo: canUndo(edit),
      blockId: edit.blockId ?? null,
      html: edit.html ?? null,
      text: edit.text ?? null,
    }))
  },
})

// --- Summon and dismiss (called from assistantDispatch.ts) ---

/** Where the assistant goes: the room's main LiveKit room, named on the server as for every token. */
export const summonTarget = internalQuery({
  args: { roomId: v.id("rooms"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const room = await getRoomOrThrow(ctx, args.roomId)
    return { livekitRoomName: toRoomIdentity(room).livekitRoomName }
  },
})

export const checkSummonLimit = internalMutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    await checkAssistantRateLimit(ctx, args.roomId, "summon")
  },
})

export const revokeGrants = internalMutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const grants = await ctx.db.query("roomAccessGrants").withIndex("by_room", q => q.eq("roomId", args.roomId)).collect()
    for (const grant of grants) {
      if (grant.identity.startsWith(ASSISTANT_IDENTITY_PREFIX)) await ctx.db.delete(grant._id)
    }
  },
})

/** What was heard is kept only as long as it can be undone. */
export const deleteOldEdits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("assistantEdits").withIndex("by_created", q => q.lt("createdAt", Date.now() - EDIT_KEEP_MS)).take(500)
    for (const edit of old) await ctx.db.delete(edit._id)
  },
})
