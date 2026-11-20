/**
 * Where the assistant puts things on a board. It never sees the screen, so it names neighbours and
 * layouts; the coordinates are worked out here, clear of what people already drew.
 */
import { elementBounds, type Rect } from "../../src/components/whiteboard/geometry"

export const GAP = 24

export type Side = "right" | "left" | "below" | "above"
export type Layout = "row" | "column" | "grid"
type Size = { width: number; height: number }

export const boxOf = (el: any): Rect => elementBounds(el)

const union = (boxes: Rect[]): Rect => {
  const x = Math.min(...boxes.map(b => b.x))
  const y = Math.min(...boxes.map(b => b.y))
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y }
}

/** Offsets of boxes laid out as one block: in a row, a column, or a grid that is about as wide as it is tall. */
export const layoutBlock = (sizes: Size[], layout?: Layout) => {
  const perRow = layout === "row" ? sizes.length
    : layout === "column" ? 1
    : layout === "grid" ? Math.ceil(Math.sqrt(sizes.length))
    : 4
  const offsets: { x: number; y: number }[] = []
  let x = 0, y = 0, rowHeight = 0
  sizes.forEach((size, i) => {
    if (i > 0 && i % perRow === 0) {
      y += rowHeight + GAP
      x = 0
      rowHeight = 0
    }
    offsets.push({ x, y })
    x += size.width + GAP
    rowHeight = Math.max(rowHeight, size.height)
  })
  const width = Math.max(0, ...sizes.map((s, i) => offsets[i].x + s.width))
  const height = Math.max(0, ...sizes.map((s, i) => offsets[i].y + s.height))
  return { offsets, width, height }
}

const isFree = (box: Rect, obstacles: Rect[]) =>
  !obstacles.some(o =>
    box.x < o.x + o.width + GAP && box.x + box.width + GAP > o.x &&
    box.y < o.y + o.height + GAP && box.y + box.height + GAP > o.y)

const STEP: Record<Side, { x: number; y: number }> = {
  right: { x: GAP, y: 0 }, left: { x: -GAP, y: 0 }, below: { x: 0, y: GAP }, above: { x: 0, y: -GAP },
}

/**
 * The top left corner for a block of this size. Beside the anchor when there is one, moving further
 * out on that side until nothing is in the way. Otherwise the first free spot among what is already
 * there, so it lands where people are looking; only a full board sends it to the right of everything.
 */
export const placeBlock = (obstacles: Rect[], size: Size, anchor?: { box: Rect; side: Side }) => {
  if (anchor) {
    const { box: a, side } = anchor
    let at = side === "right" ? { x: a.x + a.width + 2 * GAP, y: a.y }
      : side === "left" ? { x: a.x - 2 * GAP - size.width, y: a.y }
      : side === "below" ? { x: a.x, y: a.y + a.height + 2 * GAP }
      : { x: a.x, y: a.y - 2 * GAP - size.height }
    for (let i = 0; i < 1000 && !isFree({ ...at, ...size }, obstacles); i++) {
      at = { x: at.x + STEP[side].x, y: at.y + STEP[side].y }
    }
    return at
  }
  // On an empty board, clear of the floating toolbar.
  if (obstacles.length === 0) return { x: 80, y: 140 }
  const area = union(obstacles)
  const step = Math.max(GAP, Math.ceil(Math.max(area.width, area.height) / 80))
  for (let y = area.y; y + size.height <= area.y + area.height; y += step) {
    for (let x = area.x; x + size.width <= area.x + area.width; x += step) {
      if (isFree({ x, y, ...size }, obstacles)) return { x, y }
    }
  }
  return { x: area.x + area.width + 2 * GAP, y: area.y }
}

const EDGE = {
  right: { fx: 1, fy: 0.5 }, left: { fx: 0, fy: 0.5 }, bottom: { fx: 0.5, fy: 1 }, top: { fx: 0.5, fy: 0 },
}

/** Whether the straight line from p to q runs through the inside of a box; along its edge does not count. */
const crosses = (p: { x: number; y: number }, q: { x: number; y: number }, b: Rect) => {
  let t0 = 0, t1 = 1
  const clip = (d: number, from: number, lo: number, hi: number) => {
    if (d === 0) return from > lo && from < hi
    const a = (lo - from) / d, c = (hi - from) / d
    t0 = Math.max(t0, Math.min(a, c))
    t1 = Math.min(t1, Math.max(a, c))
    return t0 < t1
  }
  return clip(q.x - p.x, p.x, b.x, b.x + b.width) && clip(q.y - p.y, p.y, b.y, b.y + b.height)
}

/**
 * Where an arrow from one box to another docks, as fractions of each box, the form the board keeps
 * bound arrow ends in: on the edges that face each other. Arrows are straight, so when something is in
 * the way it goes along the far sides instead (under or over a row, beside a column).
 */
export const dockArrow = (from: Rect, to: Rect, obstacles: Rect[] = []) => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  const across = Math.abs(dx) >= Math.abs(dy)
  const facing = across
    ? (dx >= 0 ? { start: EDGE.right, end: EDGE.left } : { start: EDGE.left, end: EDGE.right })
    : (dy >= 0 ? { start: EDGE.bottom, end: EDGE.top } : { start: EDGE.top, end: EDGE.bottom })
  const around = across
    ? [{ start: EDGE.bottom, end: EDGE.bottom }, { start: EDGE.top, end: EDGE.top }]
    : [{ start: EDGE.right, end: EDGE.right }, { start: EDGE.left, end: EDGE.left }]
  const clear = (dock: typeof facing) => !obstacles.some(b => crosses(pointOn(from, dock.start), pointOn(to, dock.end), b))
  return [facing, ...around].find(clear) ?? facing
}

export const pointOn = (box: Rect, at: { fx: number; fy: number }) => ({ x: box.x + at.fx * box.width, y: box.y + at.fy * box.height })
