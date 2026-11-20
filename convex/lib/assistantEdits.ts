/**
 * What the assistant put on the board or into the notes, and the one rule both follow:
 * a client keeps saving its whole board or document, so an addition it never had would be
 * lost by its next save. An addition survives a save from a client that never showed it;
 * once a client has shown it, leaving it out deletes it. An addition that was undone never
 * comes back, whatever an older client sends.
 *
 * What it changed, moved or deleted of what was already there follows the same idea: a client that
 * still sends an element exactly as it was before the assistant touched it has not caught up, and
 * the assistant's version stays. A client that changed the element itself wins, as between people,
 * even when it changed it back to how it was: a save that names its changes is never a stale copy.
 */
import { boardSignature } from "../../src/components/whiteboard/operations"

/** The worker joins with a grant under this identity. Only such a grant may write as the assistant. */
export const ASSISTANT_IDENTITY_PREFIX = "assistant:"

/** Edits stay this long: long enough to undo and to show what was heard, no longer. */
export const EDIT_KEEP_MS = 2 * 60 * 60 * 1000

export type AssistantEdit = {
  _id: string
  roomId: string
  kind: "board" | "notes" | "reply" | "view"
  heard: string
  createdAt: number
  undoneAt?: number
  commandId?: string
  action?: string
  count?: number
  elementIds?: string[]
  generation?: number
  before?: any[]
  after?: (any | null)[]
  above?: (string | null)[]
  view?: string
  focusIds?: string[]
  blockId?: string
  html?: string
  text?: string
}

export const recentEdits = async (ctx: any, roomId: string, now = Date.now()): Promise<AssistantEdit[]> => {
  const rows: AssistantEdit[] = await ctx.db
    .query("assistantEdits")
    .withIndex("by_room_created", (q: any) => q.eq("roomId", roomId).gte("createdAt", now - EDIT_KEEP_MS))
    .collect()
  // The index returns them oldest first, ties in the order they were written.
  return rows.reverse()
}

/** A board change belongs to the board it was made on. Edits from before generations were kept count as on the wall. */
export const onWall = (edit: AssistantEdit, generation: number) =>
  edit.kind !== "board" || edit.generation === undefined || edit.generation === generation

const splitEdits = (edits: AssistantEdit[]) => ({
  active: edits.filter(edit => !edit.undoneAt),
  undone: edits.filter(edit => edit.undoneAt),
})

export const mergeAssistantElements = async (
  ctx: any,
  roomId: string,
  generation: number,
  current: any[],
  incoming: any[],
  seenIds: string[] | undefined,
  // An edit sends only what the person changed, so nothing in it is a stale copy.
  explicit = false,
) => {
  const { active, undone } = splitEdits(
    // A board put back from the history is that board again, whatever the assistant did to it before.
    (await recentEdits(ctx, roomId)).filter(edit => edit.kind === "board" && onWall(edit, generation)),
  )
  const undoneIds = new Set(undone.flatMap(edit => edit.elementIds ?? []))
  const activeIds = new Set(active.flatMap(edit => edit.elementIds ?? []))
  const seen = new Set(seenIds ?? [])
  const kept = incoming.filter(el => !undoneIds.has(el.id))
  const sent = new Set(kept.map(el => el.id))
  const unseen = current.filter(el => activeIds.has(el.id) && !sent.has(el.id) && !seen.has(el.id))
  return explicit ? [...kept, ...unseen] : keepTouched([...kept, ...unseen], current, active)
}

/** The same element, field for field, whatever order the fields came in. */
export const sameElement = (a: any, b: any) => boardSignature([a]) === boardSignature([b])

/** An element sent exactly as it was before the assistant touched it gives way to the board's version. */
const keepTouched = (elements: any[], current: any[], active: AssistantEdit[]) => {
  const stale = new Map<string, any[]>()
  for (const edit of active) {
    for (const before of edit.before ?? []) stale.set(before.id, [...(stale.get(before.id) ?? []), before])
  }
  if (stale.size === 0) return elements
  const now = new Map(current.map(el => [el.id, el]))
  const out: any[] = []
  for (const el of elements) {
    const olds = stale.get(el.id)
    if (!olds || !olds.some(old => sameElement(old, el))) out.push(el)
    else if (now.has(el.id)) out.push(now.get(el.id))
    // Not on the board any more: the assistant deleted it.
  }
  return out
}

/**
 * Takes the assistant's block out of the notes, up to its own closing tag: a list someone nested inside
 * it closes with the same tag first.
 */
export const removeBlock = (html: string, blockId: string) => {
  const start = new RegExp(`<(h[1-6]|p|ul|ol|blockquote) data-assistant="${blockId}">`)
  let out = html
  for (let found = start.exec(out); found; found = start.exec(out)) {
    const tags = new RegExp(`<(/?)${found[1]}[\\s>]`, "g")
    tags.lastIndex = found.index + found[0].length
    let depth = 1
    let end = -1
    for (let tag = tags.exec(out); tag; tag = tags.exec(out)) {
      depth += tag[1] ? -1 : 1
      if (depth === 0) { end = out.indexOf(">", tag.index) + 1; break }
    }
    if (end <= 0) return out
    out = out.slice(0, found.index) + out.slice(end)
  }
  return out
}

const hasBlock = (html: string, blockId: string) => html.includes(`data-assistant="${blockId}"`)

export const mergeAssistantBlocks = async (
  ctx: any,
  roomId: string,
  currentHtml: string,
  incomingHtml: string,
  seenIds: string[] | undefined,
) => {
  const { active, undone } = splitEdits((await recentEdits(ctx, roomId)).filter(edit => edit.kind === "notes" && edit.blockId))
  const seen = new Set(seenIds ?? [])
  let html = undone.reduce((acc, edit) => removeBlock(acc, edit.blockId!), incomingHtml)
  // Oldest first, so blocks come back in the order they were written.
  for (const edit of [...active].reverse()) {
    const id = edit.blockId!
    if (!hasBlock(html, id) && !seen.has(id) && hasBlock(currentHtml, id) && edit.html) html += edit.html
  }
  return html
}
