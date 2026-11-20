// Where board elements are, and what a point or a pointer path touches. Pure: no canvas, no React.
import { WHITEBOARD_MORE_SHAPES, type WhiteboardBinding, type WhiteboardElement, type WhiteboardLine, type WhiteboardMoreShape, type WhiteboardPoint } from '../../types';

export type Rect = { x: number; y: number; width: number; height: number };

const boxOfPoints = (points: WhiteboardPoint[]): Rect => {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** How far an elbow connector first runs straight out of a side before it turns. */
const ELBOW_STUB = 24;
/** A section's name sits on a tab above its top left corner. */
export const SECTION_TAB_HEIGHT = 28;
export const SECTION_TAB_MAX_WIDTH = 240;

type Dir = { x: number; y: number };

/** The way out of the side a bound end sits on, or null when it sits inside the box. */
const sideOf = (binding?: WhiteboardBinding): Dir | null => {
  if (!binding) return null;
  if (binding.fx <= 0.001) return { x: -1, y: 0 };
  if (binding.fx >= 0.999) return { x: 1, y: 0 };
  if (binding.fy <= 0.001) return { x: 0, y: -1 };
  if (binding.fy >= 0.999) return { x: 0, y: 1 };
  return null;
};

/** Towards `to` along the axis that covers most of the way. */
const towards = (from: WhiteboardPoint, to: WhiteboardPoint): Dir =>
  Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: Math.sign(to.x - from.x) || 1, y: 0 } : { x: 0, y: Math.sign(to.y - from.y) || 1 };

const tidy = (points: WhiteboardPoint[]) => {
  const out: WhiteboardPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out[out.length - 2];
    // A point in the middle of a straight run is no bend.
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
};

/** An elbow route from p, leaving along ds, to q, arriving against de (de points out of the end's box). */
const elbowRoute = (p: WhiteboardPoint, ds: Dir, q: WhiteboardPoint, de: Dir): WhiteboardPoint[] => {
  const a = { x: p.x + ds.x * ELBOW_STUB, y: p.y + ds.y * ELBOW_STUB };
  const b = { x: q.x + de.x * ELBOW_STUB, y: q.y + de.y * ELBOW_STUB };
  const across = (d: Dir) => d.x !== 0;
  if (across(ds) && across(de)) {
    if (ds.x === -de.x && ds.x * (q.x - p.x) >= 0) {
      const mid = (p.x + q.x) / 2;
      return [p, { x: mid, y: p.y }, { x: mid, y: q.y }, q];
    }
    if (ds.x === de.x) {
      const x = ds.x > 0 ? Math.max(a.x, b.x) : Math.min(a.x, b.x);
      return [p, { x, y: p.y }, { x, y: q.y }, q];
    }
    const mid = (p.y + q.y) / 2;
    return [p, a, { x: a.x, y: mid }, { x: b.x, y: mid }, b, q];
  }
  if (!across(ds) && !across(de)) {
    if (ds.y === -de.y && ds.y * (q.y - p.y) >= 0) {
      const mid = (p.y + q.y) / 2;
      return [p, { x: p.x, y: mid }, { x: q.x, y: mid }, q];
    }
    if (ds.y === de.y) {
      const y = ds.y > 0 ? Math.max(a.y, b.y) : Math.min(a.y, b.y);
      return [p, { x: p.x, y }, { x: q.x, y }, q];
    }
    const mid = (p.x + q.x) / 2;
    return [p, a, { x: mid, y: a.y }, { x: mid, y: b.y }, b, q];
  }
  if (across(ds)) {
    if (ds.x * (q.x - p.x) > 0 && de.y * (p.y - q.y) > 0) return [p, { x: q.x, y: p.y }, q];
    return [p, a, { x: a.x, y: b.y }, b, q];
  }
  if (ds.y * (q.y - p.y) > 0 && de.x * (p.x - q.x) > 0) return [p, { x: p.x, y: q.y }, q];
  return [p, a, { x: b.x, y: a.y }, b, q];
};

/** The points a line is drawn through: as stored, or for an elbow connector its right-angled route between its ends. */
export const linePath = (line: WhiteboardLine): WhiteboardPoint[] => {
  if (!line.elbow || line.points.length < 2) return line.points;
  const p = line.points[0], q = line.points[line.points.length - 1];
  const ds = sideOf(line.start) ?? towards(p, q);
  const de = sideOf(line.end) ?? towards(q, p);
  return tidy(elbowRoute(p, ds, q, de));
};

/** The element's box in board coordinates, with positive width and height. */
export const elementBounds = (el: WhiteboardElement): Rect => {
  if (el.type === 'stroke') return boxOfPoints(el.points);
  if (el.type === 'line') return boxOfPoints(linePath(el));
  let { x, y, width, height } = el;
  if (width < 0) { x += width; width = -width; }
  if (height < 0) { y += height; height = -height; }
  return { x, y, width, height };
};

/** The box around several elements, or null for none. */
export const boundsOfAll = (elements: WhiteboardElement[]): Rect | null => {
  if (elements.length === 0) return null;
  const boxes = elements.map(elementBounds);
  const x = Math.min(...boxes.map(b => b.x));
  const y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
};

export const rectsTouch = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

const distanceToSegment = (p: WhiteboardPoint, a: WhiteboardPoint, b: WhiteboardPoint) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const nearPolyline = (points: WhiteboardPoint[], p: WhiteboardPoint, reach: number) => {
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y) <= reach;
  for (let i = 1; i < points.length; i++) if (distanceToSegment(p, points[i - 1], points[i]) <= reach) return true;
  return false;
};

/** Whether a point is on the element. Lines and pen strokes count only near what was drawn; `tolerance` is in board units. */
/** Where a path is drawn: a canvas, or the string a file's path element takes. */
export type PathSink = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
};

/** The corners of the shapes that are polygons, in a box. */
const polygonOf = (kind: WhiteboardMoreShape, { x, y, width: w, height: h }: Rect): WhiteboardPoint[] | null => {
  if (kind === 'triangle') return [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (kind === 'hexagon') {
    const k = Math.min(w * 0.25, h * 0.5);
    return [{ x: x + k, y }, { x: x + w - k, y }, { x: x + w, y: y + h / 2 }, { x: x + w - k, y: y + h }, { x: x + k, y: y + h }, { x, y: y + h / 2 }];
  }
  if (kind === 'parallelogram') {
    const k = Math.min(w * 0.2, h * 0.6);
    return [{ x: x + k, y }, { x: x + w, y }, { x: x + w - k, y: y + h }, { x, y: y + h }];
  }
  if (kind === 'block-arrow') {
    const head = x + w - Math.min(w * 0.45, h * 0.9);
    return [
      { x, y: y + h * 0.3 }, { x: head, y: y + h * 0.3 }, { x: head, y }, { x: x + w, y: y + h / 2 },
      { x: head, y: y + h }, { x: head, y: y + h * 0.7 }, { x, y: y + h * 0.7 },
    ];
  }
  if (kind === 'star') {
    const cx = x + w / 2, cy = y + h / 2;
    // Five points, the top one straight up; scaled so the star fills its box from top to bottom.
    const unit = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 === 0 ? 1 : 0.42, a = -Math.PI / 2 + (i * Math.PI) / 5;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
    const bottom = Math.max(...unit.map(p => p.y));
    return unit.map(p => ({ x: cx + (p.x * w) / 2, y: y + ((p.y + 1) / (1 + bottom)) * h }));
  }
  return null;
};

/** Half an ellipse from one end of its horizontal axis to the other, over the top or under the bottom. */
const halfEllipse = (sink: PathSink, cx: number, cy: number, rx: number, ry: number, over: boolean, fromLeft: boolean) => {
  const c = 0.5523, s = fromLeft ? 1 : -1, v = over ? -1 : 1;
  sink.bezierCurveTo(cx - s * rx, cy + v * c * ry, cx - s * c * rx, cy + v * ry, cx, cy + v * ry);
  sink.bezierCurveTo(cx + s * c * rx, cy + v * ry, cx + s * rx, cy + v * c * ry, cx + s * rx, cy);
};

/** Traces the outline of one of the "more shapes" in a box. */
export const traceOutline = (sink: PathSink, kind: WhiteboardMoreShape, box: Rect) => {
  const { x, y, width: w, height: h } = box;
  const corners = polygonOf(kind, box);
  if (corners) {
    corners.forEach((p, i) => (i === 0 ? sink.moveTo(p.x, p.y) : sink.lineTo(p.x, p.y)));
    sink.closePath();
  } else if (kind === 'speech') {
    const bottom = y + h * 0.8, r = Math.min(16, w * 0.15, h * 0.15);
    sink.moveTo(x + r, y);
    sink.lineTo(x + w - r, y);
    sink.quadraticCurveTo(x + w, y, x + w, y + r);
    sink.lineTo(x + w, bottom - r);
    sink.quadraticCurveTo(x + w, bottom, x + w - r, bottom);
    sink.lineTo(x + w * 0.42, bottom);
    sink.lineTo(x + w * 0.2, y + h);
    sink.lineTo(x + w * 0.26, bottom);
    sink.lineTo(x + r, bottom);
    sink.quadraticCurveTo(x, bottom, x, bottom - r);
    sink.lineTo(x, y + r);
    sink.quadraticCurveTo(x, y, x + r, y);
    sink.closePath();
  } else if (kind === 'cylinder') {
    const ry = Math.min(h * 0.12, w * 0.25), cx = x + w / 2, rx = w / 2;
    sink.moveTo(x, y + ry);
    halfEllipse(sink, cx, y + ry, rx, ry, true, true);
    sink.lineTo(x + w, y + h - ry);
    halfEllipse(sink, cx, y + h - ry, rx, ry, false, false);
    sink.closePath();
    // The front rim of the top.
    sink.moveTo(x, y + ry);
    halfEllipse(sink, cx, y + ry, rx, ry, false, true);
  } else {
    // A cloud: bumps between points on an inner ellipse, each bulging out to the box.
    const cx = x + w / 2, cy = y + h / 2, n = 9;
    const at = (a: number, r: number) => ({ x: cx + (r * w * Math.cos(a)) / 2, y: cy + (r * h * Math.sin(a)) / 2 });
    const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const first = at(angle(0), 0.72);
    sink.moveTo(first.x, first.y);
    for (let i = 0; i < n; i++) {
      const bulge = at((angle(i) + angle(i + 1)) / 2, 1);
      const next = at(angle(i + 1), 0.72);
      sink.quadraticCurveTo(bulge.x, bulge.y, next.x, next.y);
    }
    sink.closePath();
  }
};

/** The same outline as the d of an SVG path. */
export const outlinePath = (kind: WhiteboardMoreShape, box: Rect) => {
  const n = (v: number) => Math.round(v * 100) / 100;
  const parts: string[] = [];
  traceOutline({
    moveTo: (x, y) => parts.push(`M${n(x)} ${n(y)}`),
    lineTo: (x, y) => parts.push(`L${n(x)} ${n(y)}`),
    quadraticCurveTo: (cx, cy, x, y) => parts.push(`Q${n(cx)} ${n(cy)} ${n(x)} ${n(y)}`),
    bezierCurveTo: (a, b, c, d, x, y) => parts.push(`C${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(x)} ${n(y)}`),
    closePath: () => parts.push('Z'),
  }, kind, box);
  return parts.join(' ');
};

/** A polygon with its corners rounded off by up to `radius`. */
export const traceRoundedPolygon = (sink: PathSink, corners: WhiteboardPoint[], radius: number) => {
  const n = corners.length;
  const towardsBy = (from: WhiteboardPoint, to: WhiteboardPoint, d: number) => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const k = Math.min(d, len / 2) / len;
    return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
  };
  const start = towardsBy(corners[0], corners[1], radius);
  sink.moveTo(start.x, start.y);
  for (let i = 1; i <= n; i++) {
    const corner = corners[i % n], prev = corners[i - 1], next = corners[(i + 1) % n];
    const a = towardsBy(corner, prev, radius), b = towardsBy(corner, next, radius);
    sink.lineTo(a.x, a.y);
    sink.quadraticCurveTo(corner.x, corner.y, b.x, b.y);
  }
  sink.closePath();
};

/** A diamond's corners in its box. */
export const diamondCorners = ({ x, y, width: w, height: h }: Rect): WhiteboardPoint[] =>
  [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }];
export const diamondRadius = (b: Rect) => Math.min(b.width, b.height) * 0.12;

/** The same rounded polygon as the d of an SVG path. */
export const roundedPolygonPath = (corners: WhiteboardPoint[], radius: number) => {
  const n = (v: number) => Math.round(v * 100) / 100;
  const parts: string[] = [];
  traceRoundedPolygon({
    moveTo: (x, y) => parts.push(`M${n(x)} ${n(y)}`),
    lineTo: (x, y) => parts.push(`L${n(x)} ${n(y)}`),
    quadraticCurveTo: (cx, cy, x, y) => parts.push(`Q${n(cx)} ${n(cy)} ${n(x)} ${n(y)}`),
    bezierCurveTo: () => undefined,
    closePath: () => parts.push('Z'),
  }, corners, radius);
  return parts.join(' ');
};

/** A table's cell box. */
export const tableCellBox = (el: WhiteboardElement, row: number, col: number): Rect => {
  const b = elementBounds(el);
  const cells = el.type === 'shape' && el.cells ? el.cells : [['']];
  const w = b.width / cells[0].length, h = b.height / cells.length;
  return { x: b.x + col * w, y: b.y + row * h, width: w, height: h };
};

/** The cell of a table under a point, or null outside it. */
export const tableCellAt = (el: WhiteboardElement, p: WhiteboardPoint) => {
  const b = elementBounds(el);
  const cells = el.type === 'shape' && el.cells ? el.cells : [['']];
  if (p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height) return null;
  const col = Math.min(cells[0].length - 1, Math.floor(((p.x - b.x) / b.width) * cells[0].length));
  const row = Math.min(cells.length - 1, Math.floor(((p.y - b.y) / b.height) * cells.length));
  return { row, col };
};

/** The branches of the mind maps on a board: from the right of each parent to the left of its child, in the child's colour. */
export const mindmapLinks = (elements: WhiteboardElement[]) => {
  const byId = new Map(elements.map(el => [el.id, el]));
  return elements.flatMap(el => {
    if (el.type !== 'shape' || !el.parent) return [];
    const parent = byId.get(el.parent);
    if (!parent) return [];
    const a = elementBounds(parent), b = elementBounds(el);
    const from = { x: a.x + a.width, y: a.y + a.height / 2 }, to = { x: b.x, y: b.y + b.height / 2 };
    const bend = Math.max(20, (to.x - from.x) / 2);
    return [{ from, c1: { x: from.x + bend, y: from.y }, c2: { x: to.x - bend, y: to.y }, to, color: el.strokeColor, opacity: el.opacity ?? 1 }];
  });
};

export const isMoreShape = (shapeType: string): shapeType is WhiteboardMoreShape =>
  (WHITEBOARD_MORE_SHAPES as readonly string[]).includes(shapeType);

const insidePolygon = (p: WhiteboardPoint, corners: WhiteboardPoint[]) => {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i], b = corners[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

export const hitTest = (el: WhiteboardElement, p: WhiteboardPoint, tolerance: number): boolean => {
  if (el.type === 'stroke') return nearPolyline(el.points, p, tolerance + el.size / 2);
  if (el.type === 'line') return nearPolyline(linePath(el), p, tolerance + el.strokeWidth / 2);
  const b = elementBounds(el);
  if (el.type === 'shape' && el.shapeType === 'section') {
    // Only its frame and name tab: a drag inside a section is for what lies on it.
    const onTab = p.x >= b.x && p.x <= b.x + Math.min(b.width, SECTION_TAB_MAX_WIDTH) && p.y >= b.y - SECTION_TAB_HEIGHT && p.y <= b.y;
    const near = (v: number, edge: number) => Math.abs(v - edge) <= tolerance;
    const inX = p.x >= b.x - tolerance && p.x <= b.x + b.width + tolerance;
    const inY = p.y >= b.y - tolerance && p.y <= b.y + b.height + tolerance;
    return onTab || (inY && (near(p.x, b.x) || near(p.x, b.x + b.width))) || (inX && (near(p.y, b.y) || near(p.y, b.y + b.height)));
  }
  if (p.x < b.x - tolerance || p.x > b.x + b.width + tolerance || p.y < b.y - tolerance || p.y > b.y + b.height + tolerance) return false;
  if (el.type !== 'shape' || (el.shapeType !== 'circle' && el.shapeType !== 'diamond' && !isMoreShape(el.shapeType))) return true;
  if (isMoreShape(el.shapeType)) {
    const corners = polygonOf(el.shapeType, b);
    return !corners || insidePolygon(p, corners) || nearPolyline([...corners, corners[0]], p, tolerance);
  }
  const rx = b.width / 2 + tolerance, ry = b.height / 2 + tolerance;
  const nx = (p.x - (b.x + b.width / 2)) / rx, ny = (p.y - (b.y + b.height / 2)) / ry;
  return el.shapeType === 'circle' ? nx * nx + ny * ny <= 1 : Math.abs(nx) + Math.abs(ny) <= 1;
};

/** Moved by dx, dy. A moved line lets go of what it was bound to: it no longer starts or ends there. */
export const moveElement = (el: WhiteboardElement, dx: number, dy: number): WhiteboardElement => {
  if (el.type === 'stroke') return { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
  if (el.type === 'line') return { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })), start: undefined, end: undefined };
  return { ...el, x: el.x + dx, y: el.y + dy };
};

/** Fitted into a new box. Points scale with it; a box keeps its own shape. */
export const resizeElement = (el: WhiteboardElement, box: Rect): WhiteboardElement => {
  if (el.type === 'stroke' || el.type === 'line') {
    const from = elementBounds(el);
    const sx = from.width === 0 ? 1 : box.width / from.width;
    const sy = from.height === 0 ? 1 : box.height / from.height;
    const points = el.points.map(p => ({ x: box.x + (p.x - from.x) * sx, y: box.y + (p.y - from.y) * sy }));
    return el.type === 'line' ? { ...el, points, start: undefined, end: undefined } : { ...el, points };
  }
  return { ...el, ...box };
};

/** The ids of the elements an eraser path went over. Locked ones stay. */
export const touchedByPath = (elements: WhiteboardElement[], path: WhiteboardPoint[], tolerance: number) =>
  elements.filter(el => !el.locked && path.some(p => hitTest(el, p, tolerance))).map(el => el.id);
