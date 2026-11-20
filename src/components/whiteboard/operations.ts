// What the board does to a selection: style, order, alignment, groups, copies, and arrows that follow
// their shapes. Pure: each takes the elements and returns new ones, untouched elements stay the same objects.
import type { WhiteboardElement, WhiteboardFillStyle, WhiteboardStrokeStyle } from '../../types';
import { boundsOfAll, elementBounds, hitTest, moveElement, rectsTouch, type Rect } from './geometry';

export const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `wb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export type StylePatch = {
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
  strokeStyle?: WhiteboardStrokeStyle;
  fillStyle?: WhiteboardFillStyle;
  roundness?: 'sharp' | 'round';
  opacity?: number;
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  startArrow?: boolean;
  endArrow?: boolean;
  markerColor?: string;
};

/** The part of a style that applies to this kind of element, under the element's own field names. */
const styleFor = (el: WhiteboardElement, s: StylePatch): Partial<WhiteboardElement> => {
  const pick = <K extends keyof StylePatch>(...keys: K[]) =>
    Object.fromEntries(keys.filter(k => s[k] !== undefined).map(k => [k, s[k]])) as Pick<StylePatch, K>;
  const common = pick('opacity');
  switch (el.type) {
    case 'stroke':
      // A marker keeps its own width and takes the marker colours.
      if (el.tool === 'marker') return { ...common, ...(s.markerColor !== undefined && { color: s.markerColor }) };
      return { ...common, ...(s.strokeColor !== undefined && { color: s.strokeColor }), ...(s.strokeWidth !== undefined && { size: s.strokeWidth }) };
    case 'line':
      return { ...common, ...pick('strokeColor', 'strokeWidth', 'strokeStyle', 'startArrow', 'endArrow') };
    case 'shape':
      return { ...common, ...pick('strokeColor', 'fillColor', 'strokeWidth', 'strokeStyle', 'fillStyle', 'roundness', 'fontSize', 'textAlign') };
    case 'text':
      return { ...common, ...(s.strokeColor !== undefined && { color: s.strokeColor }), ...pick('fontSize', 'textAlign') };
    case 'image':
    case 'html':
    case 'stamp':
      return common;
  }
};

export const restyle = (elements: WhiteboardElement[], ids: string[], style: StylePatch): WhiteboardElement[] => {
  const chosen = new Set(ids);
  return elements.map(el => (chosen.has(el.id) ? ({ ...el, ...styleFor(el, style) } as WhiteboardElement) : el));
};

export type Order = 'front' | 'back' | 'forward' | 'backward';

/** Later elements are drawn on top. The moved ones keep their order among themselves. */
export const reorder = (elements: WhiteboardElement[], ids: string[], where: Order): WhiteboardElement[] => {
  const chosen = new Set(ids);
  const moved = elements.filter(el => chosen.has(el.id));
  const rest = elements.filter(el => !chosen.has(el.id));
  if (where === 'front') return [...rest, ...moved];
  if (where === 'back') return [...moved, ...rest];
  const out = [...elements];
  const step = where === 'forward' ? 1 : -1;
  const indices = out.flatMap((el, i) => (chosen.has(el.id) ? [i] : []));
  // Walk from the side we move towards, so a run of selected elements moves as one.
  for (const i of step > 0 ? indices.reverse() : indices) {
    const j = i + step;
    if (j < 0 || j >= out.length || chosen.has(out[j].id)) continue;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** The ids with every other member of their groups. */
export const withGroups = (elements: WhiteboardElement[], ids: string[]): string[] => {
  const chosen = new Set(ids);
  const groups = new Set(elements.filter(el => chosen.has(el.id) && el.groupId).map(el => el.groupId));
  return elements.filter(el => chosen.has(el.id) || (el.groupId && groups.has(el.groupId))).map(el => el.id);
};

export const group = (elements: WhiteboardElement[], ids: string[]): WhiteboardElement[] => {
  if (ids.length < 2) return elements;
  const groupId = newId();
  const chosen = new Set(withGroups(elements, ids));
  return elements.map(el => (chosen.has(el.id) ? { ...el, groupId } : el));
};

export const ungroup = (elements: WhiteboardElement[], ids: string[]): WhiteboardElement[] => {
  const chosen = new Set(withGroups(elements, ids));
  return elements.map(el => (chosen.has(el.id) && el.groupId ? { ...el, groupId: undefined } : el));
};

/** The selection as things that move together: each group is one, each ungrouped element is one. */
const unitsOf = (elements: WhiteboardElement[], ids: string[]) => {
  const chosen = new Set(ids);
  const units = new Map<string, WhiteboardElement[]>();
  for (const el of elements) {
    if (!chosen.has(el.id)) continue;
    const key = el.groupId ? `g:${el.groupId}` : el.id;
    units.set(key, [...(units.get(key) ?? []), el]);
  }
  return [...units.values()].map(members => ({ members, box: boundsOfAll(members)! }));
};

const shiftUnits = (elements: WhiteboardElement[], shifts: Map<string, { dx: number; dy: number }>) => {
  if ([...shifts.values()].every(s => s.dx === 0 && s.dy === 0)) return elements;
  return elements.map(el => {
    const s = shifts.get(el.id);
    return s && (s.dx || s.dy) ? moveElement(el, s.dx, s.dy) : el;
  });
};

export type Edge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Lines the selection up on one edge or centre of the box around all of it. */
export const align = (elements: WhiteboardElement[], ids: string[], edge: Edge): WhiteboardElement[] => {
  const units = unitsOf(elements, ids);
  if (units.length < 2) return elements;
  const all = boundsOfAll(units.flatMap(u => u.members))!;
  const target = (b: Rect) => {
    switch (edge) {
      case 'left': return { dx: all.x - b.x, dy: 0 };
      case 'center': return { dx: all.x + all.width / 2 - (b.x + b.width / 2), dy: 0 };
      case 'right': return { dx: all.x + all.width - (b.x + b.width), dy: 0 };
      case 'top': return { dx: 0, dy: all.y - b.y };
      case 'middle': return { dx: 0, dy: all.y + all.height / 2 - (b.y + b.height / 2) };
      case 'bottom': return { dx: 0, dy: all.y + all.height - (b.y + b.height) };
    }
  };
  const shifts = new Map<string, { dx: number; dy: number }>();
  for (const u of units) {
    const s = target(u.box);
    u.members.forEach(m => shifts.set(m.id, s));
  }
  return followBindings(shiftUnits(elements, shifts));
};

/** Equal gaps between three or more, the outer two stay where they are. */
export const distribute = (elements: WhiteboardElement[], ids: string[], axis: 'horizontal' | 'vertical'): WhiteboardElement[] => {
  const units = unitsOf(elements, ids);
  if (units.length < 3) return elements;
  const h = axis === 'horizontal';
  const start = (b: Rect) => (h ? b.x : b.y);
  const size = (b: Rect) => (h ? b.width : b.height);
  units.sort((a, b) => start(a.box) - start(b.box));
  const first = units[0].box, last = units[units.length - 1].box;
  const span = start(last) + size(last) - start(first);
  const gap = (span - units.reduce((sum, u) => sum + size(u.box), 0)) / (units.length - 1);
  const shifts = new Map<string, { dx: number; dy: number }>();
  let at = start(first);
  for (const u of units) {
    const d = at - start(u.box);
    u.members.forEach(m => shifts.set(m.id, h ? { dx: d, dy: 0 } : { dx: 0, dy: d }));
    at += size(u.box) + gap;
  }
  return followBindings(shiftUnits(elements, shifts));
};

/**
 * Copies beside the originals, added on top. Copies get new ids and new groups, and an arrow copied
 * with the shape it is bound to stays bound to the copy.
 */
export const duplicate = (elements: WhiteboardElement[], ids: string[], offset: number) => {
  const chosen = new Set(withGroups(elements, ids));
  const originals = elements.filter(el => chosen.has(el.id));
  const idMap = new Map(originals.map(el => [el.id, newId()]));
  const groupMap = new Map<string, string>();
  const copies = originals.map(el => {
    const moved = moveElement(el, offset, offset);
    const groupId = el.groupId ? groupMap.get(el.groupId) ?? groupMap.set(el.groupId, newId()).get(el.groupId) : undefined;
    const copy = { ...moved, id: idMap.get(el.id)!, groupId, author: undefined } as WhiteboardElement;
    if (el.type === 'line' && copy.type === 'line') {
      copy.start = el.start && idMap.has(el.start.id) ? { ...el.start, id: idMap.get(el.start.id)! } : undefined;
      copy.end = el.end && idMap.has(el.end.id) ? { ...el.end, id: idMap.get(el.end.id)! } : undefined;
    }
    if (el.type === 'stamp' && copy.type === 'stamp') copy.on = el.on && idMap.has(el.on.id) ? { ...el.on, id: idMap.get(el.on.id)! } : undefined;
    // A copied node whose parent stays behind starts a map of its own.
    if (el.type === 'shape' && copy.type === 'shape' && el.parent) copy.parent = idMap.get(el.parent);
    return copy;
  });
  return { elements: [...elements, ...copies], added: copies.map(c => c.id) };
};

/**
 * Puts the bound ends of every arrow back on their elements, wherever those now are, and every stamp
 * back on the spot of its element. An arrow end whose element is gone lets go; a stamp goes with it.
 * Returns the same array when nothing moved.
 */
export const followBindings = (elements: WhiteboardElement[]): WhiteboardElement[] => {
  // A mind map node whose parent is gone goes too, and so does its branch.
  const present = new Set(elements.map(el => el.id));
  let orphans = elements.filter(el => el.type === 'shape' && el.parent && !present.has(el.parent));
  if (orphans.length) {
    const gone = new Set<string>();
    while (orphans.length) {
      orphans.forEach(el => gone.add(el.id));
      orphans = elements.filter(el => el.type === 'shape' && el.parent && gone.has(el.parent) && !gone.has(el.id));
    }
    return followBindings(elements.filter(el => !gone.has(el.id)));
  }
  const byId = new Map(elements.map(el => [el.id, el]));
  let changed = false;
  const out = elements.flatMap((el): WhiteboardElement[] => {
    if (el.type === 'stamp' && el.on) {
      const target = byId.get(el.on.id);
      if (!target || target === el) { changed = true; return []; }
      const b = elementBounds(target);
      const x = b.x + el.on.fx * b.width - el.width / 2, y = b.y + el.on.fy * b.height - el.height / 2;
      if (x === el.x && y === el.y) return [el];
      changed = true;
      return [{ ...el, x, y }];
    }
    if (el.type !== 'line' || (!el.start && !el.end)) return [el];
    const points = [...el.points];
    const next = { ...el, points };
    for (const side of ['start', 'end'] as const) {
      const binding = el[side];
      if (!binding) continue;
      const target = byId.get(binding.id);
      if (!target || target === el) { next[side] = undefined; changed = true; continue; }
      const b = elementBounds(target);
      const p = { x: b.x + binding.fx * b.width, y: b.y + binding.fy * b.height };
      const i = side === 'start' ? 0 : points.length - 1;
      if (points[i].x !== p.x || points[i].y !== p.y) { points[i] = p; changed = true; }
    }
    return [next];
  });
  return changed ? out : elements;
};

const isSection = (el: WhiteboardElement) => el.type === 'shape' && el.shapeType === 'section';
const inside = (b: Rect, outer: Rect) => b.x >= outer.x && b.y >= outer.y && b.x + b.width <= outer.x + outer.width && b.y + b.height <= outer.y + outer.height;

/**
 * The ids with what they carry: everything that lies fully on one of the chosen sections (sections on
 * sections included), and the whole branch of a chosen mind map node.
 */
export const withSectionContents = (elements: WhiteboardElement[], ids: string[]): string[] => {
  const chosen = new Set(ids);
  const branches = new Map<string, WhiteboardElement[]>();
  for (const el of elements) if (el.type === 'shape' && el.parent) branches.set(el.parent, [...(branches.get(el.parent) ?? []), el]);
  const queue = elements.filter(el => chosen.has(el.id) && (isSection(el) || branches.has(el.id)));
  while (queue.length) {
    const carrier = queue.pop()!;
    const area = isSection(carrier) ? elementBounds(carrier) : null;
    const carried = area ? elements.filter(el => inside(elementBounds(el), area)) : branches.get(carrier.id) ?? [];
    for (const el of carried) {
      if (chosen.has(el.id) || el.locked) continue;
      chosen.add(el.id);
      if (isSection(el) || branches.has(el.id)) queue.push(el);
    }
  }
  return elements.filter(el => chosen.has(el.id)).map(el => el.id);
};

/**
 * Moves the chosen elements. An arrow moved together with what it is bound to keeps that binding;
 * one moved without it lets go; arrows bound to moved elements follow them.
 */
export const moveSelection = (elements: WhiteboardElement[], ids: string[], dx: number, dy: number): WhiteboardElement[] => {
  if (dx === 0 && dy === 0) return elements;
  const picked = new Set(ids);
  const chosen = new Set(withSectionContents(elements, ids));
  const moved = elements.map(el => {
    if (!chosen.has(el.id)) return el;
    const next = moveElement(el, dx, dy);
    if (el.type === 'line' && next.type === 'line') {
      // Only a line someone picked up lets go; one a section carries along stays on its shapes.
      const keep = (binding?: { id: string }) => binding && (chosen.has(binding.id) || !picked.has(el.id)) ? binding : undefined;
      next.start = keep(el.start) as typeof el.start;
      next.end = keep(el.end) as typeof el.end;
    }
    return next;
  });
  // A stamp moved without what it sat on sticks to whatever it lands on.
  const restuck = moved.map(el => {
    if (el.type !== 'stamp' || !chosen.has(el.id) || (el.on && chosen.has(el.on.id))) return el;
    const centre = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    return { ...el, on: bindingAt(moved.filter(other => !chosen.has(other.id)), centre, el.id, 0) };
  });
  return followBindings(restuck);
};

/** The element an arrow end at `p` binds to: the topmost box-like element there, never a line, a pen stroke, a stamp, a section or itself. */
export const bindingAt = (elements: WhiteboardElement[], p: { x: number; y: number }, selfId: string, tolerance: number) => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.id === selfId || el.type === 'line' || el.type === 'stroke' || el.type === 'stamp' || isSection(el) || !hitTest(el, p, tolerance)) continue;
    const b = elementBounds(el);
    const fraction = (v: number, start: number, size: number) => (size === 0 ? 0.5 : Math.max(0, Math.min(1, (v - start) / size)));
    return { id: el.id, fx: fraction(p.x, b.x, b.width), fy: fraction(p.y, b.y, b.height) };
  }
  return undefined;
};

/** The end point turned to the nearest 15 degrees around the start, at the same distance. */
export const snapAngle = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
};

type Line = Extract<WhiteboardElement, { type: 'line' }>;

/**
 * Binds one end of a line to the element it was dropped on, or frees it. An end dropped inside a box
 * moves out to the box's edge on the side the line comes from, so the arrow touches the shape instead of
 * ending in its middle.
 */
export const bindEnd = (elements: WhiteboardElement[], line: Line, side: 'start' | 'end', tolerance: number): Line => {
  const i = side === 'start' ? 0 : line.points.length - 1;
  const p = line.points[i];
  const other = line.points[side === 'start' ? 1 : line.points.length - 2];
  const binding = bindingAt(elements, p, line.id, tolerance);
  if (!binding) return { ...line, [side]: undefined };
  const b = elementBounds(elements.find(el => el.id === binding.id)!);
  const inside = (q: { x: number; y: number }) => q.x >= b.x && q.x <= b.x + b.width && q.y >= b.y && q.y <= b.y + b.height;
  let q = { x: Math.max(b.x, Math.min(b.x + b.width, p.x)), y: Math.max(b.y, Math.min(b.y + b.height, p.y)) };
  if (inside(p) && other && !inside(other)) {
    // Walk from the dropped point towards the other end until the box is left.
    const dx = other.x - p.x, dy = other.y - p.y;
    const exit = (d: number, at: number, lo: number, hi: number) => (d > 0 ? (hi - at) / d : d < 0 ? (lo - at) / d : Infinity);
    const t = Math.min(exit(dx, p.x, b.x, b.x + b.width), exit(dy, p.y, b.y, b.y + b.height));
    q = { x: p.x + dx * t, y: p.y + dy * t };
  }
  const points = [...line.points];
  points[i] = q;
  const fraction = (v: number, start: number, size: number) => (size === 0 ? 0.5 : (v - start) / size);
  return { ...line, points, [side]: { id: binding.id, fx: fraction(q.x, b.x, b.width), fy: fraction(q.y, b.y, b.height) } };
};

type Shape = Extract<WhiteboardElement, { type: 'shape' }>;
export type Side = 'right' | 'left' | 'below' | 'above';
const NOTE_GAP = 24;
const CONNECT_GAP = 80;

/** The first spot for a box this size, stepping from `start` along a side until nothing but sections is in the way. */
const freeSpot = (elements: WhiteboardElement[], start: Rect, side: Side, gap: number): Rect => {
  const step = side === 'right' ? { x: start.width + gap, y: 0 } : side === 'left' ? { x: -start.width - gap, y: 0 }
    : side === 'below' ? { x: 0, y: start.height + gap } : { x: 0, y: -start.height - gap };
  const obstacles = elements.filter(el => !isSection(el) && el.type !== 'stamp').map(elementBounds);
  let box = start;
  for (let i = 0; i < 200 && obstacles.some(o => rectsTouch(o, box)); i++) box = { ...box, x: box.x + step.x, y: box.y + step.y };
  return box;
};

const besideBox = (b: Rect, side: Side, gap: number): Rect => ({
  ...b,
  x: side === 'right' ? b.x + b.width + gap : side === 'left' ? b.x - b.width - gap : b.x,
  y: side === 'below' ? b.y + b.height + gap : side === 'above' ? b.y - b.height - gap : b.y,
});

/** An empty copy of a note beside it, in its colour and size, written by `by`. Tab on a note makes a row this way. */
export const nextNote = (elements: WhiteboardElement[], id: string, by?: string) => {
  const note = elements.find(el => el.id === id) as Shape;
  const box = freeSpot(elements, besideBox(elementBounds(note), 'right', NOTE_GAP), 'right', NOTE_GAP);
  const copy: Shape = { ...note, ...box, id: newId(), text: '', by, author: undefined, groupId: undefined, locked: undefined };
  return { elements: [...elements, copy], added: copy.id };
};

const EDGE_OF: Record<Side, { fx: number; fy: number }> = {
  right: { fx: 1, fy: 0.5 }, left: { fx: 0, fy: 0.5 }, below: { fx: 0.5, fy: 1 }, above: { fx: 0.5, fy: 0 },
};
const OPPOSITE: Record<Side, Side> = { right: 'left', left: 'right', below: 'above', above: 'below' };

/** The next shape on one side of a shape, empty and in its style, already joined to it by an elbow connector. */
export const connectNew = (elements: WhiteboardElement[], id: string, side: Side) => {
  const from = elements.find(el => el.id === id) as Shape;
  const b = elementBounds(from);
  const box = freeSpot(elements, besideBox(b, side, CONNECT_GAP), side, CONNECT_GAP);
  const shape: Shape = { ...from, ...box, id: newId(), text: '', by: undefined, author: undefined, groupId: undefined, locked: undefined };
  const start = EDGE_OF[side], end = EDGE_OF[OPPOSITE[side]];
  const at = (r: Rect, e: { fx: number; fy: number }) => ({ x: r.x + e.fx * r.width, y: r.y + e.fy * r.height });
  const arrow: WhiteboardElement = {
    id: newId(), type: 'line', points: [at(b, start), at(box, end)], strokeColor: '#18181b', strokeWidth: 2,
    endArrow: true, elbow: true, start: { id: from.id, ...start }, end: { id: shape.id, ...end },
  };
  return { elements: [...elements, shape, arrow], added: [shape.id, arrow.id] };
};

export type TemplateColumn = { title: string; fill: string; prompt: string };
const TEMPLATE_GAP = 40;
const TEMPLATE_INSET = 24;

/**
 * A template: one named section per column, side by side, each with a starter note in it. It goes to
 * the right of what is on the board, or at `at` on an empty one.
 */
export const fromTemplate = (
  elements: WhiteboardElement[], columns: TemplateColumn[], size: { width: number; height: number }, at: { x: number; y: number }, by?: string,
) => {
  const there = boundsOfAll(elements);
  const origin = there ? { x: there.x + there.width + 120, y: there.y } : at;
  const added = columns.flatMap((column, i): WhiteboardElement[] => {
    const x = origin.x + i * (size.width + TEMPLATE_GAP);
    const section: Shape = {
      id: newId(), type: 'shape', shapeType: 'section', x, y: origin.y, ...size, text: column.title,
      strokeColor: '#18181b', fillColor: 'transparent', strokeWidth: 0,
    };
    const note: Shape = {
      id: newId(), type: 'shape', shapeType: 'note', x: x + TEMPLATE_INSET, y: origin.y + TEMPLATE_INSET, width: 200, height: 200,
      text: column.prompt || undefined, strokeColor: 'transparent', fillColor: column.fill, strokeWidth: 0, by,
    };
    return [section, note];
  });
  return { elements: [...elements, ...added], added: added.map(el => el.id) };
};

// --- Mind maps ---

/** The colours the branches off a root take in turn; whatever grows from a branch keeps its colour. */
export const MINDMAP_INKS = ['#2563eb', '#16a34a', '#7c3aed', '#ea580c', '#dc2626'];
export const MINDMAP_NODE = { width: 120, height: 40 };
const MINDMAP_GAP_X = 56;
const MINDMAP_GAP_Y = 16;

const asShape = (el: WhiteboardElement | undefined) => (el?.type === 'shape' ? el : undefined);

/** The root of the map a node belongs to. */
export const mindmapRoot = (elements: WhiteboardElement[], id: string): Shape | undefined => {
  const byId = new Map(elements.map(el => [el.id, el]));
  let node = asShape(byId.get(id));
  for (let i = 0; node?.parent && i < 1000; i++) node = asShape(byId.get(node.parent)) ?? node;
  return node;
};

/**
 * Lays a map out from its root, which stays where it is: each node's children stand in a column to its
 * right, centred on it, every branch with room for all of its own.
 */
export const layoutMindmap = (elements: WhiteboardElement[], anyId: string): WhiteboardElement[] => {
  const root = mindmapRoot(elements, anyId);
  if (!root) return elements;
  const children = new Map<string, Shape[]>();
  for (const el of elements) if (el.type === 'shape' && el.shapeType === 'mindmap' && el.parent) children.set(el.parent, [...(children.get(el.parent) ?? []), el]);
  const heights = new Map<string, number>();
  const heightOf = (node: Shape): number => {
    const kids = children.get(node.id) ?? [];
    const h = Math.max(node.height, kids.reduce((sum, k) => sum + heightOf(k), 0) + MINDMAP_GAP_Y * Math.max(0, kids.length - 1));
    heights.set(node.id, h);
    return h;
  };
  heightOf(root);
  const placed = new Map<string, { x: number; y: number }>();
  const place = (node: Shape, x: number, centreY: number) => {
    placed.set(node.id, { x, y: centreY - node.height / 2 });
    const kids = children.get(node.id) ?? [];
    const total = kids.reduce((sum, k) => sum + heights.get(k.id)!, 0) + MINDMAP_GAP_Y * Math.max(0, kids.length - 1);
    let top = centreY - total / 2;
    for (const kid of kids) {
      const h = heights.get(kid.id)!;
      place(kid, x + node.width + MINDMAP_GAP_X, top + h / 2);
      top += h + MINDMAP_GAP_Y;
    }
  };
  place(root, root.x, root.y + root.height / 2);
  const out = elements.map(el => {
    const at = placed.get(el.id);
    return at && el.type === 'shape' && (el.x !== at.x || el.y !== at.y) ? { ...el, ...at } : el;
  });
  return followBindings(out);
};

/** A new empty node: a child of `fromId`, or a sibling after it (a sibling of the root is a child of it). Laid out at once. */
export const addMindmapNode = (elements: WhiteboardElement[], fromId: string, where: 'child' | 'sibling', by?: string) => {
  const from = asShape(elements.find(el => el.id === fromId))!;
  const parent = where === 'child' || !from.parent ? from : asShape(elements.find(el => el.id === from.parent))!;
  const branches = elements.filter(el => el.type === 'shape' && el.parent === parent.id).length;
  const strokeColor = parent.parent ? parent.strokeColor : MINDMAP_INKS[branches % MINDMAP_INKS.length];
  const node: Shape = {
    id: newId(), type: 'shape', shapeType: 'mindmap', parent: parent.id, x: parent.x + parent.width + MINDMAP_GAP_X, y: parent.y,
    ...MINDMAP_NODE, strokeColor, fillColor: '#ffffff', strokeWidth: 2, fontSize: parent.fontSize, by,
  };
  // A sibling goes right after the node it was made from, so the column keeps the order it was made in.
  const at = where === 'sibling' && from.parent ? elements.findIndex(el => el.id === from.id) + 1 : elements.length;
  const next = [...elements.slice(0, at), node, ...elements.slice(at)];
  return { elements: layoutMindmap(next, parent.id), added: node.id };
};

// --- Tables ---

/** A table with rows or columns added (positive) or taken from the end (negative); a cell keeps its size. */
/** The largest table the server stores. */
export const TABLE_LIMITS = { rows: 50, columns: 12 };

export const resizeTable = (table: Shape, change: { rows?: number; columns?: number }): Shape => {
  const cells = table.cells ?? [['']];
  const rows = cells.length, columns = cells[0].length;
  const nextRows = Math.min(TABLE_LIMITS.rows, Math.max(1, rows + (change.rows ?? 0)));
  const nextColumns = Math.min(TABLE_LIMITS.columns, Math.max(1, columns + (change.columns ?? 0)));
  const grown = Array.from({ length: nextRows }, (_, r) => Array.from({ length: nextColumns }, (_, c) => cells[r]?.[c] ?? ''));
  return { ...table, cells: grown, width: (table.width / columns) * nextColumns, height: (table.height / rows) * nextRows };
};

/** The cell Tab (step 1) or Shift+Tab (step -1) goes to; one past the last cell is the first of a new row. */
export const nextCell = (table: Shape, row: number, col: number, step: 1 | -1) => {
  const columns = (table.cells ?? [['']])[0].length;
  const at = Math.max(0, row * columns + col + step);
  return { row: Math.floor(at / columns), col: at % columns };
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().filter(k => record[k] !== undefined).map(k => [k, canonical(record[k])]));
  }
  return value;
};

/**
 * A board's content as one string, the same however its fields are ordered. Convex hands stored elements
 * back with their fields sorted, so comparing plain JSON never recognises the board's own saves.
 */
/**
 * What writing lands on: the newest state from the others (`missed`) if one came in while this person wrote,
 * so their moves and changes meanwhile are not sent back old. Changes made here since the last state taken in
 * (`confirmed`) stay; the rest is as the newer state has it.
 */
export const rebaseWriting = (elements: WhiteboardElement[], confirmed: WhiteboardElement[], missed: WhiteboardElement[] | null) => {
  if (!missed) return elements;
  const before = new Map(confirmed.map(e => [e.id, e]));
  const mine = new Map(elements.map(e => [e.id, e]));
  const base = missed
    .filter(e => mine.has(e.id) || !before.has(e.id))
    .map(e => { const m = mine.get(e.id); return m && m !== before.get(e.id) ? m : e; });
  const inBase = new Set(base.map(e => e.id));
  return [...base, ...elements.filter(e => !inBase.has(e.id) && !before.has(e.id))];
};

/**
 * The base with one element changed. One the base does not have is added if it was just made here;
 * one the others deleted meanwhile (it was in the last state taken in) stays deleted.
 */
export const writeElement = (base: WhiteboardElement[], el: WhiteboardElement, patch: Partial<WhiteboardElement>, confirmed: WhiteboardElement[]) => {
  if (base.some(e => e.id === el.id)) return base.map(e => (e.id === el.id ? ({ ...e, ...patch } as WhiteboardElement) : e));
  if (confirmed.some(e => e.id === el.id)) return base;
  return [...base, { ...el, ...patch } as WhiteboardElement];
};

export const boardSignature = (elements: WhiteboardElement[]) => JSON.stringify(canonical(elements));

/** The first line of what an element says, to name it in a list; empty when it says nothing. */
export const elementWords = (el: WhiteboardElement | undefined) =>
  !el ? '' : (('text' in el && el.text) || ('title' in el && el.title) || (el.type === 'shape' && el.cells?.flat().find(Boolean)) || '').trim().split('\n')[0].slice(0, 80);
