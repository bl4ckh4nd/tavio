import { query, mutation } from "./_generated/server"
import { ConvexError, v } from "convex/values"
import { validateUrl } from "./lib/validation"
import { checkWhiteboardRateLimit } from "./lib/rateLimit"
import { requireRoomResourceAccess } from "./lib/roomAccess"
import { getLastClosedSession, getOpenSession } from "./lib/sessions"
import { mergeAssistantElements } from "./lib/assistantEdits"
import { WHITEBOARD_MORE_SHAPES, WHITEBOARD_STAMPS } from "../src/types"
import { checkView } from "../src/components/whiteboard/viewCatalog"
import { CHAT_ORPHAN_UPLOAD_MS } from "./lib/chatMedia"
import { TABLE_LIMITS } from "../src/components/whiteboard/operations"

/**
 * A board is "carried over" when a session runs and nobody has drawn on it or put it on the wall since that session began.
 * The client then asks once whether to go on with it or start a new one.
 */
const carriedOver = async (ctx: any, roomId: string, snapshot: any) => {
  if (snapshot.elements.length === 0) return null
  const open = await getOpenSession(ctx, roomId)
  if (!open) return null
  const lastTouched = Math.max(snapshot.changedAt ?? 0, snapshot.placedAt ?? 0)
  if (lastTouched >= open.startedAt) return null
  const previous = await getLastClosedSession(ctx, roomId)
  return { sessionId: open._id as string, from: (previous?.startedAt ?? (lastTouched || null)) as number | null }
}

export const get = query({
  args: { roomId: v.string(), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const snapshot = await ctx.db
      .query("whiteboardSnapshots")
      .withIndex("by_room", q => q.eq("roomId", args.roomId))
      .first()
    if (!snapshot) return { roomId: args.roomId, elements: [] as any[] }
    return {
      roomId: args.roomId,
      elements: snapshot.elements as any[],
      name: (snapshot.name ?? null) as string | null,
      boardStartedAt: (snapshot.boardStartedAt ?? null) as number | null,
      generation: (snapshot.generation ?? 0) as number,
      changedAt: (snapshot.changedAt ?? null) as number | null,
      carriedOver: await carriedOver(ctx, args.roomId, snapshot),
    }
  }
})

const MAX_SHAPE_TEXT = 500
const MAX_NAME = 60
const MAX_LABEL = 200
const MAX_TEXT = 5000
const MAX_TITLE = 120
const { rows: MAX_TABLE_ROWS, columns: MAX_TABLE_COLUMNS } = TABLE_LIMITS
const MAX_CELL = 500
const MAX_PAGE = 300_000
// Pages are big; a room keeps this many at most, so nobody can fill the storage with them.
const MAX_PAGES = 50
const MAX_POINTS = 10000
export const MAX_ELEMENTS = 10000
const MAX_COORDINATE = 50000
const STROKE_STYLES = ["solid", "dashed", "dotted"]
const FILL_STYLES = ["solid", "hachure", "cross-hatch"]
const TEXT_ALIGNS = ["left", "center", "right"]

const isCoordinate = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= -MAX_COORDINATE && n <= MAX_COORDINATE
const checkColor = (value: unknown, what: string, required = true) => {
  if (value === undefined && !required) return
  // Canvas and SVG take a colour as a plain string; a short cap keeps junk out of every client's paint calls.
  if (typeof value !== "string" || !value || value.length > 64) throw new Error(`Invalid ${what} color`)
}
const checkWidth = (value: unknown, what: string, min: number) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > 100) throw new Error(`Invalid ${what}`)
}
const checkPoints = (points: unknown, min: number) => {
  if (!Array.isArray(points) || points.length < min) throw new Error(`Needs at least ${min} points`)
  if (points.length > MAX_POINTS) throw new Error("Too many points (max 10,000)")
  for (const point of points) {
    if (!point || !isCoordinate(point.x) || !isCoordinate(point.y)) throw new Error("Invalid point coordinates")
  }
}
const checkBox = (element: any, what: string) => {
  if (![element.x, element.y, element.width, element.height].every(isCoordinate)) {
    throw new Error(`${what}: coordinates missing or out of bounds (must be between -50000 and 50000)`)
  }
}
const checkBinding = (binding: any) => {
  if (binding === undefined) return
  const fraction = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1
  if (!binding || typeof binding.id !== "string" || !binding.id || binding.id.length > 100 || !fraction(binding.fx) || !fraction(binding.fy)) {
    throw new Error("Invalid arrow binding")
  }
}
/** What every kind can carry. */
const checkCommon = (element: any) => {
  if (element.opacity !== undefined && (typeof element.opacity !== "number" || !(element.opacity >= 0.05 && element.opacity <= 1))) {
    throw new Error("Invalid opacity (0.05 to 1)")
  }
  if (element.groupId !== undefined && (typeof element.groupId !== "string" || !element.groupId || element.groupId.length > 100)) {
    throw new Error("Invalid group id")
  }
  if (element.locked !== undefined && typeof element.locked !== "boolean") throw new Error("Invalid locked flag")
  if (element.strokeStyle !== undefined && !STROKE_STYLES.includes(element.strokeStyle)) throw new Error("Invalid stroke style")
  if (element.author !== undefined && element.author !== "assistant") throw new Error("Invalid element author")
  if (element.by !== undefined && (typeof element.by !== "string" || element.by.length > MAX_NAME)) throw new Error(`Invalid writer name (at most ${MAX_NAME} characters)`)
}

/** Checks every element and gives legacy ones an id. Throws on the first one that is not a board element. */
export const validateWhiteboardElements = (elements: any[]) => {
  // Validate element count to prevent DoS
  if (elements.length > MAX_ELEMENTS) {
    throw new Error("Too many whiteboard elements (max 10,000)")
  }
  // Backfill ids for legacy elements created before id enforcement. A pasted image that only has a blob:
  // address exists in the one browser it was pasted in; nobody else can see it, so it is not kept.
  const normalizedElements = elements.filter((element: any) => !(element?.type === "image" && typeof element.src === "string" && element.src.trim().startsWith("blob:"))).map((element: any, index: number) => {
    if (element && typeof element.id === "string" && element.id) {
      return element
    }
    return {
      ...element,
      id: `wb-legacy-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
    }
  })

  const VALID_TYPES = ["stroke", "shape", "image", "line", "text", "stamp", "html", "rectangle", "circle"]
  const VALID_SHAPE_TYPES = ["rectangle", "circle", "diamond", "note", "section", "task", "table", "mindmap", ...WHITEBOARD_MORE_SHAPES]
  const VALID_STROKE_TOOLS = ["pen", "eraser", "marker"]

  for (const element of normalizedElements) {
    if (!element || typeof element !== "object") {
      throw new Error("Invalid element structure")
    }
    if (!VALID_TYPES.includes(element.type)) {
      throw new Error(`Invalid element type: ${element.type}`)
    }
    if (typeof element.id !== "string" || !element.id) {
      throw new Error("Element missing required id field")
    }
    checkCommon(element)

    if (element.type === "stroke") {
      if (!VALID_STROKE_TOOLS.includes(element.tool)) {
        throw new Error("Invalid stroke tool")
      }
      checkColor(element.color, "stroke")
      if (typeof element.size !== "number" || element.size <= 0) {
        throw new Error("Invalid stroke size")
      }
      checkPoints(element.points, 1)
      continue
    }

    if (element.type === "line") {
      checkPoints(element.points, 2)
      checkColor(element.strokeColor, "line")
      checkWidth(element.strokeWidth, "line width", 0.5)
      for (const flag of [element.startArrow, element.endArrow]) {
        if (flag !== undefined && typeof flag !== "boolean") throw new Error("Invalid arrowhead")
      }
      checkBinding(element.start)
      checkBinding(element.end)
      if (element.elbow !== undefined && typeof element.elbow !== "boolean") throw new Error("Invalid elbow flag")
      if (element.label !== undefined && (typeof element.label !== "string" || element.label.length > MAX_LABEL)) {
        throw new Error(`Connector label must be a string of at most ${MAX_LABEL} characters`)
      }
      continue
    }

    if (element.type === "stamp") {
      if (!(WHITEBOARD_STAMPS as readonly string[]).includes(element.stamp)) throw new Error("Invalid stamp")
      checkBox(element, "Stamp")
      checkBinding(element.on)
      continue
    }

    if (element.type === "html") {
      if (typeof element.page !== "string" || !element.page || element.page.length > 64) throw new Error("A page of HTML must name its page")
      if (typeof element.title !== "string" || element.title.length > MAX_TITLE) throw new Error(`Page title must be at most ${MAX_TITLE} characters`)
      checkBox(element, "Page")
      continue
    }

    if (element.type === "text") {
      checkBox(element, "Text")
      if (typeof element.text !== "string" || element.text.length === 0 || element.text.length > MAX_TEXT) {
        throw new Error(`Text must be 1 to ${MAX_TEXT} characters`)
      }
      checkColor(element.color, "text")
      if (typeof element.fontSize !== "number" || !(element.fontSize >= 8 && element.fontSize <= 200)) {
        throw new Error("Invalid font size (8 to 200)")
      }
      if (element.textAlign !== undefined && !TEXT_ALIGNS.includes(element.textAlign)) throw new Error("Invalid text alignment")
      continue
    }

    if (element.type === "image") {
      if (typeof element.src !== "string" || !element.src) {
        throw new Error("Image element missing src")
      }
      const src = element.src.trim()
      if (!src.startsWith("data:image/")) {
        validateUrl(src, "Whiteboard image URL")
      }
      checkBox(element, "Image")
      if (element.width <= 0 || element.height <= 0) {
        throw new Error("Invalid image bounds")
      }
      continue
    }

    const shapeType =
      element.type === "shape"
        ? element.shapeType
        : element.type
    if (!VALID_SHAPE_TYPES.includes(shapeType)) {
      throw new Error("Invalid shape type")
    }
    checkBox(element, "Shape")
    checkColor(element.strokeColor, "stroke")
    if (typeof element.fillColor !== "string" || element.fillColor.length > 64) {
      throw new Error("Shape missing fill color")
    }
    if (typeof element.strokeWidth !== "number" || element.strokeWidth < 0) {
      throw new Error("Invalid strokeWidth value")
    }
    if (element.fillStyle !== undefined && !FILL_STYLES.includes(element.fillStyle)) throw new Error("Invalid fill style")
    if (element.roundness !== undefined && element.roundness !== "sharp" && element.roundness !== "round") {
      throw new Error("Invalid roundness")
    }
    if (element.text !== undefined && (typeof element.text !== "string" || element.text.length > MAX_SHAPE_TEXT)) {
      throw new Error(`Shape text must be a string of at most ${MAX_SHAPE_TEXT} characters`)
    }
    if (element.fontSize !== undefined && (typeof element.fontSize !== "number" || !(element.fontSize >= 8 && element.fontSize <= 200))) {
      throw new Error("Invalid font size (8 to 200)")
    }
    if (element.textAlign !== undefined && !TEXT_ALIGNS.includes(element.textAlign)) throw new Error("Invalid text alignment")
    if (element.cells !== undefined) {
      const rows = element.cells
      const columns = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0].length : 0
      const fits = Array.isArray(rows) && rows.length >= 1 && rows.length <= MAX_TABLE_ROWS && columns >= 1 && columns <= MAX_TABLE_COLUMNS
        && rows.every((row: any) => Array.isArray(row) && row.length === columns && row.every((cell: any) => typeof cell === "string" && cell.length <= MAX_CELL))
      if (!fits) throw new Error(`A table has 1 to ${MAX_TABLE_ROWS} rows of 1 to ${MAX_TABLE_COLUMNS} cells, each at most ${MAX_CELL} characters`)
    }
    if (element.parent !== undefined && (typeof element.parent !== "string" || !element.parent || element.parent.length > 100)) {
      throw new Error("Invalid mind map parent")
    }
    if (element.done !== undefined && typeof element.done !== "boolean") throw new Error("A task's done mark must be true or false")
    if (element.owner !== undefined && (typeof element.owner !== "string" || element.owner.length > MAX_NAME)) {
      throw new Error(`A task's person must be at most ${MAX_NAME} characters`)
    }
    if (element.due !== undefined && (typeof element.due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(element.due))) {
      throw new Error("A task's due date must be a date (YYYY-MM-DD)")
    }
  }

  return normalizedElements
}

type Snapshot = { _id: any; elements: any[]; generation?: number }

/**
 * A board saves its whole state, and while someone writes it does not take in what others do. What others
 * added in that time is on the wall but not in the save; it stays, after the element it followed. A board
 * from before this rule sends no list, and what it sends is the board.
 */
export const keepUnseen = (current: any[], incoming: any[], seenIds: string[] | undefined) => {
  if (!seenIds) return incoming
  const sent = new Set(incoming.map(el => el.id))
  const seen = new Set(seenIds)
  const out = [...incoming]
  current.forEach((el, i) => {
    if (sent.has(el.id) || seen.has(el.id)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex(other => other.id === current[j].id)
      if (k !== -1) { at = k + 1; break }
    }
    out.splice(at, 0, el)
  })
  return out
}

/** Puts a new state on the wall. Saves and the assistant both go through here, so the session history sees the same thing. */
export const writeWall = async (ctx: any, roomId: string, existing: Snapshot | null, elements: any[]) => {
  const now = Date.now()
  if (existing) {
    await ctx.db.patch(existing._id, {
      elements,
      changedAt: now,
      sameAsArchiveId: undefined,
      // A board starts with its first stroke, not when the empty sheet was hung up.
      ...(existing.elements.length === 0 && elements.length > 0 ? { boardStartedAt: now } : {}),
    })
    return existing.generation ?? 0
  }
  await ctx.db.insert("whiteboardSnapshots", { roomId, elements, boardStartedAt: now, changedAt: now, generation: 0 })
  return 0
}

/**
 * An image uploaded for the board is kept once a board of its room is saved with it. One no board took
 * is cleaned up like an unsent chat image, so uploads alone cannot fill the storage.
 */
const keepBoardImages = async (ctx: any, roomId: string, elements: any[]) => {
  const shown = new Set(elements
    .filter(el => el.type === "image" && typeof el.src === "string" && !el.src.startsWith("data:"))
    .map(el => el.src.trim()))
  if (shown.size === 0) return
  // Only uploads still waiting for a board or a message; older ones the hourly cleanup has removed.
  const pending = await ctx.db
    .query("chatUploads")
    .withIndex("by_orphan", (q: any) => q.eq("messageId", undefined).eq("keptFor", undefined).gte("createdAt", Date.now() - CHAT_ORPHAN_UPLOAD_MS))
    .collect()
  for (const upload of pending) {
    if (upload.roomId !== roomId) continue
    if (shown.has(await ctx.storage.getUrl(upload.storageId))) await ctx.db.patch(upload._id, { keptFor: "board" })
  }
}

export const getWall = async (ctx: any, roomId: string): Promise<Snapshot | null> =>
  await ctx.db.query("whiteboardSnapshots").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).first()

export const save = mutation({
  args: {
    roomId: v.string(),
    elements: v.array(v.any()),
    accessToken: v.optional(v.string()),
    // The board the client drew on. A save for a board that has since left the wall is dropped, not applied.
    generation: v.optional(v.number()),
    // The assistant's elements this board has shown. One it never showed cannot have been deleted on it.
    seenAssistantIds: v.optional(v.array(v.string())),
    // What this board has shown and left out: what it deleted. Others' additions it never showed stay.
    seenIds: v.optional(v.array(v.string())),
    edit: v.optional(v.object({
      removedIds: v.array(v.string()),
      addedIds: v.array(v.string()),
      order: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, args) => {
    // Rate limiting (120 saves per minute for interactive drawing)
    await checkWhiteboardRateLimit(ctx)

    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)

    // An invalid board fails the same way every time: a ConvexError tells the client not to send it again.
    let incoming: any[]
    try {
      incoming = validateWhiteboardElements(args.elements)
    } catch (error) {
      throw new ConvexError(error instanceof Error ? error.message : "Invalid whiteboard")
    }
    const existing = await getWall(ctx, args.roomId)
    if (existing) {
      const generation = existing.generation ?? 0
      if (args.generation !== undefined && args.generation !== generation) {
        return { roomId: args.roomId, elements: existing.elements, generation, stale: true }
      }
    }
    const current = existing?.elements ?? []
    let withOthers: any[]
    if (args.edit) {
      const removed = new Set(args.edit.removedIds)
      const added = new Set(args.edit.addedIds)
      const byId = new Map(current.filter(el => !removed.has(el.id)).map(el => [el.id, el]))
      for (const el of incoming) {
        // An update to an element deleted by someone else must not resurrect it.
        if (!removed.has(el.id) && (byId.has(el.id) || added.has(el.id))) byId.set(el.id, el)
      }
      withOthers = [...byId.values()]
      if (args.edit.order) {
        const ordered = [...new Set(args.edit.order)].filter(id => byId.has(id)).map(id => byId.get(id))
        withOthers = keepUnseen(withOthers, ordered, args.edit.removedIds)
      }
    } else {
      withOthers = keepUnseen(current, incoming, args.seenIds)
    }
    const elements = await mergeAssistantElements(ctx, args.roomId, existing?.generation ?? 0, current, withOthers, args.edit?.removedIds ?? args.seenAssistantIds, !!args.edit)
    if (elements.length > MAX_ELEMENTS) throw new ConvexError("Too many whiteboard elements (max 10,000)")
    const generation = await writeWall(ctx, args.roomId, existing, elements)
    // What the save actually put on the board, not what it sent: an element the merge left out keeps nothing.
    const sentIds = new Set(incoming.map(el => el.id))
    const sentShown = elements.filter(el => sentIds.has(el.id))
    await keepBoardImages(ctx, args.roomId, sentShown)
    await keepBoardPages(ctx, args.roomId, sentShown)
    return { roomId: args.roomId, elements, generation, stale: false }
  }
})

/**
 * A page someone stores stays provisional until a board save shows it, like a pasted image. One nobody put
 * up within the hour makes room when the room is full, so stored pages nobody put up cannot block new ones.
 */
const dropProvisionalPages = async (ctx: any, pages: any[]) => {
  const since = Date.now() - CHAT_ORPHAN_UPLOAD_MS
  const kept: any[] = []
  for (const page of pages) {
    if (page.provisional && page._creationTime < since) await ctx.db.delete(page._id)
    else kept.push(page)
  }
  return kept
}

const keepBoardPages = async (ctx: any, roomId: string, elements: any[]) => {
  const shown = new Set(elements.filter(el => el.type === "html").map(el => el.page))
  if (shown.size === 0) return
  const pages = await ctx.db.query("boardPages").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).collect()
  for (const page of pages) {
    if (page.provisional && shown.has(page._id)) await ctx.db.patch(page._id, { provisional: undefined })
  }
}

/** Keeps a page of HTML for this room and returns its name, which an html element on the board carries. */
export const storePage = async (
  ctx: any,
  roomId: string,
  title: string,
  page: { html: string } | { spec: unknown },
  // Stored now, put on the board by a later save.
  provisional = false,
) => {
  let content: { html: string } | { spec: string }
  if ("html" in page) {
    if (page.html.length > MAX_PAGE) throw new ConvexError(`The page is too large (at most ${MAX_PAGE / 1000} KB)`)
    if (!page.html.trim()) throw new ConvexError("The page is empty")
    content = { html: page.html }
  } else {
    const checked = checkView(page.spec)
    if ("reason" in checked) throw new ConvexError(`The overview cannot be drawn: ${checked.reason}`)
    content = { spec: JSON.stringify(checked.spec) }
  }
  let kept = await ctx.db.query("boardPages").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).collect()
  if (kept.length >= MAX_PAGES) kept = await dropProvisionalPages(ctx, kept)
  if (kept.length >= MAX_PAGES) throw new ConvexError(`A room holds at most ${MAX_PAGES} pages`)
  return await ctx.db.insert("boardPages", { roomId, title: title.trim().slice(0, MAX_TITLE), ...content, ...(provisional ? { provisional } : {}) }) as string
}

export const addHtml = mutation({
  args: { roomId: v.string(), accessToken: v.optional(v.string()), title: v.string(), html: v.string() },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    await checkWhiteboardRateLimit(ctx)
    return await storePage(ctx, args.roomId, args.title, { html: args.html }, true)
  },
})

/** A page of HTML, only for the room it was put on. */
export const html = query({
  args: { roomId: v.string(), accessToken: v.optional(v.string()), page: v.id("boardPages") },
  handler: async (ctx, args) => {
    await requireRoomResourceAccess(ctx, args.roomId, args.accessToken)
    const page = await ctx.db.get(args.page)
    if (!page || page.roomId !== args.roomId) return null
    return page.spec !== undefined ? { title: page.title, spec: page.spec } : { title: page.title, html: page.html ?? "" }
  },
})
