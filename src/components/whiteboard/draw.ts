// Draws board elements on a 2D canvas: the live board and the PNG export use the same strokes.
import type { WhiteboardElement, WhiteboardPoint, WhiteboardStampKind, WhiteboardStrokeStyle } from '../../types';
import {
  diamondCorners, diamondRadius, elementBounds, isMoreShape, linePath, mindmapLinks, SECTION_TAB_HEIGHT, SECTION_TAB_MAX_WIDTH, tableCellBox, traceOutline, traceRoundedPolygon,
} from './geometry';

export type Paint = {
  /** The whiteboard's own colour, for the old eraser strokes. */
  board: string;
  /** Ink for text inside shapes. */
  ink: string;
  font: string;
  images: Map<string, HTMLImageElement>;
  /** A task's due day as the app shows dates. */
  dueLabel: (due: string) => string;
};

/** The bar a page of HTML has its title in; the page itself is laid over the board in the browser. */
export const PAGE_BAR = 32;
export const PAGE_EDGE = 'rgba(24, 24, 27, 0.18)';

export const NOTE_PADDING = 14;
export const NOTE_FONT_SIZE = 18;
export const NOTE_LINE_HEIGHT = 24;
export const lineHeightFor = (fontSize: number) => Math.round(fontSize * 1.25);

/** Breaks text into lines that fit a width, word by word, with a measure for the width of a run of text. */
const wrapWith = (measure: (text: string) => number, text: string, width: number) => {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
};

/** Breaks text into lines that fit a width, word by word, in the context's current font. */
export const wrapText = (ctx: CanvasRenderingContext2D, text: string, width: number) =>
  wrapWith(run => ctx.measureText(run).width, text, width);

const NOTE_SIZES = [28, 24, 20, 18, 16, 14, 12, 10];

/** The largest font a note's text fits in, wrapped into its lines. Canvas and SVG export both lay notes out with it. */
export const fitNoteText = (text: string, width: number, height: number, measure: (text: string, fontSize: number) => number) => {
  let fit = { fontSize: 10, lineHeight: lineHeightFor(10), lines: [] as string[] };
  for (const fontSize of NOTE_SIZES) {
    const lines = wrapWith(run => measure(run, fontSize), text, width);
    fit = { fontSize, lineHeight: lineHeightFor(fontSize), lines };
    if (lines.length * fit.lineHeight <= height && lines.every(line => measure(line, fontSize) <= width)) break;
  }
  return fit;
};

/** A note keeps this much room at its foot for the writer's name. */
export const NOTE_FOOT = 22;
export const NOTE_INSET = 16;
export const SECTION_FILL_DEFAULT = '#f4f1ec';

/** The inks the board's people and stamps are told apart by. */
export const PERSON_INKS = ['#2563eb', '#16a34a', '#7c3aed', '#ea580c', '#dc2626'];
export const personInk = (name: string) => {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PERSON_INKS[Math.abs(hash) % PERSON_INKS.length];
};
export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || '?';

/** Tape is paper you can see through a little. */
export const TAPE_COLOR = 'rgba(236, 224, 196, 0.82)';
export const TAPE_EDGE = 'rgba(150, 130, 100, 0.35)';
export const TAPE_SIZE = { width: 96, height: 26 };
/** Tape sits slightly askew, like a strip pressed on by hand. */
export const TAPE_TILT = -0.07;
/** A marker stroke is drawn at this opacity, so what it is drawn over still reads. */
export const MARKER_ALPHA = 0.4;

/** What each stamp shows, drawn on a 24 by 24 grid: a path (stroked or filled) or a word. */
export const STAMP_GLYPHS: Record<WhiteboardStampKind, { path?: string; fill?: boolean; text?: string; color: string; width?: number }> = {
  thumb: { path: 'M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z', color: '#16a34a', width: 2.4 },
  heart: { path: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21Z', fill: true, color: '#dc2626' },
  star: { path: 'm12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9Z', fill: true, color: '#f5b301' },
  check: { path: 'M4 12.5 9.5 18 20 6', color: '#16a34a', width: 3 },
  question: { text: '?', color: '#7c3aed' },
  plus1: { text: '+1', color: '#2563eb' },
  spark: { path: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1', color: '#ea580c', width: 2.4 },
  no: { path: 'M6 6l12 12M18 6 6 18', color: '#dc2626', width: 3 },
  tape: { path: 'M2 8.5 22 6v10L2 18.5Z', fill: true, color: TAPE_COLOR },
};

/** The point halfway along a polyline, where a connector's label sits. */
export const midpointOf = (points: WhiteboardPoint[]) => {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] && lengths[i] > 0) {
      const t = left / lengths[i];
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    left -= lengths[i];
  }
  return points[0];
};

/** The box a free text needs: as wide as its longest line, one line height per line. */
export const measureText = (ctx: CanvasRenderingContext2D, text: string, fontSize: number, font: string) => {
  ctx.save();
  ctx.font = `${fontSize}px ${font}`;
  const lines = text.split('\n');
  const width = Math.max(1, ...lines.map(line => ctx.measureText(line).width));
  ctx.restore();
  return { width: Math.ceil(width), height: lines.length * lineHeightFor(fontSize) };
};

export const dashFor = (style: WhiteboardStrokeStyle | undefined, width: number): number[] => {
  if (style === 'dashed') return [width * 4 + 6, width * 3 + 6];
  if (style === 'dotted') return [0.01, width * 2 + 5];
  return [];
};

const shapePath = (ctx: CanvasRenderingContext2D, el: Extract<WhiteboardElement, { type: 'shape' }>) => {
  const { x, y, width: w, height: h } = elementBounds(el);
  ctx.beginPath();
  if (isMoreShape(el.shapeType)) {
    traceOutline(ctx, el.shapeType, { x, y, width: w, height: h });
  } else if (el.shapeType === 'circle') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
  } else if (el.shapeType === 'diamond') {
    traceRoundedPolygon(ctx, diamondCorners({ x, y, width: w, height: h }), el.roundness === 'round' ? diamondRadius({ x, y, width: w, height: h }) : 0);
  } else if (el.roundness === 'round') {
    ctx.roundRect(x, y, w, h, Math.min(32, Math.min(w, h) * 0.25));
  } else {
    ctx.rect(x, y, w, h);
  }
};

/** Diagonal lines inside the current path: one direction for hachure, both for cross-hatch. */
const hatch = (ctx: CanvasRenderingContext2D, el: Extract<WhiteboardElement, { type: 'shape' }>, both: boolean) => {
  const { x, y, width: w, height: h } = elementBounds(el);
  const gap = Math.max(6, el.strokeWidth * 4 + 4);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = el.fillColor;
  ctx.lineWidth = Math.max(1, el.strokeWidth / 2);
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let d = -h; d < w; d += gap) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
    if (both) {
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d + h, y + h);
    }
  }
  ctx.stroke();
  ctx.restore();
};

const arrowhead = (ctx: CanvasRenderingContext2D, tip: WhiteboardPoint, from: WhiteboardPoint, width: number) => {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const length = Math.max(12, width * 4);
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - length * Math.cos(angle + side * 0.5), tip.y - length * Math.sin(angle + side * 0.5));
  }
  ctx.setLineDash([]);
  ctx.stroke();
};

type Shape = Extract<WhiteboardElement, { type: 'shape' }>;

const drawNote = (ctx: CanvasRenderingContext2D, el: Shape, paint: Paint) => {
  const { x, y, width, height } = elementBounds(el);
  ctx.save();
  ctx.shadowColor = 'rgba(40, 30, 20, 0.28)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = el.fillColor === 'transparent' ? '#fbe7b0' : el.fillColor;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 3);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = paint.ink;
  ctx.textBaseline = 'top';
  if (el.text) {
    const fit = fitNoteText(el.text, width - 2 * NOTE_INSET, height - 2 * NOTE_INSET - NOTE_FOOT, (run, size) => {
      ctx.font = `500 ${size}px ${paint.font}`;
      return ctx.measureText(run).width;
    });
    ctx.font = `500 ${fit.fontSize}px ${paint.font}`;
    fit.lines.forEach((line, i) => ctx.fillText(line, x + NOTE_INSET, y + NOTE_INSET + i * fit.lineHeight));
  }
  if (el.by) {
    ctx.globalAlpha *= 0.6;
    ctx.font = `500 12px ${paint.font}`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(el.by, x + NOTE_INSET, y + height - 10);
  }
};

/** A task card's parts, from its top left corner: the tick box, where its text starts, its foot. */
export const TASK_BOX = { x: 16, y: 16, size: 20 };
export const TASK_TEXT_X = 48;
export const TASK_FONT_SIZE = 16;
export const TASK_FOOT = 34;
export const TASK_SIZE = { width: 280, height: 150 };

/** The lines of a task's text that fit above its foot. */
export const taskLines = (text: string, width: number, height: number, measure: (run: string) => number) => {
  const lines = wrapWith(measure, text, width - TASK_TEXT_X - 16);
  return lines.slice(0, Math.max(1, Math.floor((height - TASK_BOX.y - TASK_FOOT) / lineHeightFor(TASK_FONT_SIZE))));
};

const drawTask = (ctx: CanvasRenderingContext2D, el: Shape, paint: Paint) => {
  const { x, y, width, height } = elementBounds(el);
  ctx.save();
  ctx.shadowColor = 'rgba(40, 30, 20, 0.18)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(24, 24, 27, 0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // The tick box, filled with ink and ticked when done.
  ctx.beginPath();
  ctx.roundRect(x + TASK_BOX.x, y + TASK_BOX.y, TASK_BOX.size, TASK_BOX.size, 5);
  ctx.lineWidth = 1.75;
  ctx.strokeStyle = paint.ink;
  if (el.done) { ctx.fillStyle = paint.ink; ctx.fill(); }
  ctx.stroke();
  if (el.done) {
    const bx = x + TASK_BOX.x, by = y + TASK_BOX.y;
    ctx.beginPath();
    ctx.moveTo(bx + 5, by + 10.5);
    ctx.lineTo(bx + 8.5, by + 14);
    ctx.lineTo(bx + 15, by + 6.5);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = paint.ink;
  ctx.textBaseline = 'top';
  ctx.font = `500 ${TASK_FONT_SIZE}px ${paint.font}`;
  const lineHeight = lineHeightFor(TASK_FONT_SIZE);
  const lines = el.text ? taskLines(el.text, width, height, run => ctx.measureText(run).width) : [];
  if (el.done) ctx.globalAlpha *= 0.55;
  lines.forEach((line, i) => {
    const ty = y + TASK_BOX.y + 1 + i * lineHeight;
    ctx.fillText(line, x + TASK_TEXT_X, ty);
    if (el.done) ctx.fillRect(x + TASK_TEXT_X, ty + lineHeight / 2 - 1, ctx.measureText(line).width, 1.5);
  });
  if (el.done) ctx.globalAlpha /= 0.55;
  const foot = y + height - TASK_FOOT / 2 - 2;
  ctx.textBaseline = 'middle';
  if (el.owner) {
    ctx.beginPath();
    ctx.arc(x + 16 + 11, foot, 11, 0, 2 * Math.PI);
    ctx.fillStyle = personInk(el.owner);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 10px ${paint.font}`;
    ctx.textAlign = 'center';
    ctx.fillText(initials(el.owner), x + 27, foot + 0.5);
    ctx.textAlign = 'left';
    ctx.fillStyle = paint.ink;
    ctx.font = `500 13px ${paint.font}`;
    ctx.fillText(el.owner, x + 44, foot, width / 2 - 44);
  }
  if (el.due) {
    ctx.fillStyle = paint.ink;
    ctx.font = `500 13px ${paint.font}`;
    ctx.textAlign = 'right';
    ctx.fillText(paint.dueLabel(el.due), x + width - 16, foot);
    ctx.textAlign = 'left';
  }
};

const drawSection = (ctx: CanvasRenderingContext2D, el: Shape, paint: Paint) => {
  const { x, y, width, height } = elementBounds(el);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 12);
  ctx.fillStyle = el.fillColor === 'transparent' ? SECTION_FILL_DEFAULT : el.fillColor;
  ctx.fill();
  ctx.lineWidth = Math.max(1, el.strokeWidth);
  ctx.strokeStyle = 'rgba(24, 24, 27, 0.18)';
  ctx.stroke();
  const name = el.text?.trim();
  if (!name) return;
  ctx.font = `600 14px ${paint.font}`;
  let label = name;
  const max = Math.min(width, SECTION_TAB_MAX_WIDTH) - 20;
  while (label.length > 1 && ctx.measureText(label).width > max) label = label.slice(0, -1);
  if (label !== name) label = `${label.slice(0, -1)}…`;
  const w = ctx.measureText(label).width + 20;
  ctx.beginPath();
  ctx.roundRect(x, y - SECTION_TAB_HEIGHT, w, SECTION_TAB_HEIGHT - 4, 8);
  ctx.fillStyle = paint.ink;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 10, y - SECTION_TAB_HEIGHT / 2 - 1);
};

const drawTape = (ctx: CanvasRenderingContext2D, el: Extract<WhiteboardElement, { type: 'stamp' }>) => {
  ctx.save();
  ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
  ctx.rotate(TAPE_TILT);
  ctx.beginPath();
  ctx.rect(-el.width / 2, -el.height / 2, el.width, el.height);
  ctx.fillStyle = TAPE_COLOR;
  ctx.shadowColor = 'rgba(40, 30, 20, 0.18)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = TAPE_EDGE;
  ctx.lineWidth = 0.75;
  ctx.stroke();
  ctx.restore();
};

const drawStamp = (ctx: CanvasRenderingContext2D, el: Extract<WhiteboardElement, { type: 'stamp' }>, paint: Paint) => {
  if (el.stamp === 'tape') { drawTape(ctx, el); return; }
  const r = Math.min(el.width, el.height) / 2;
  const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(40, 30, 20, 0.3)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  const glyph = STAMP_GLYPHS[el.stamp];
  if (glyph.path) {
    const scale = (r * 1.05) / 24;
    ctx.save();
    ctx.translate(cx - 12 * scale, cy - 12 * scale);
    ctx.scale(scale, scale);
    const path = new Path2D(glyph.path);
    if (glyph.fill) { ctx.fillStyle = glyph.color; ctx.fill(path); } else { ctx.strokeStyle = glyph.color; ctx.lineWidth = glyph.width ?? 2; ctx.stroke(path); }
    ctx.restore();
  } else if (glyph.text) {
    ctx.fillStyle = glyph.color;
    ctx.font = `700 ${glyph.text.length > 2 ? r * 0.55 : r * 0.8}px ${paint.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph.text, cx, cy + 1);
  }
  if (el.by) {
    const br = r * 0.42, bx = el.x + el.width - br * 0.6, by = el.y + el.height - br * 0.6;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, 2 * Math.PI);
    ctx.fillStyle = personInk(el.by);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${br * 0.85}px ${paint.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(el.by), bx, by + 0.5);
  }
};

/** How the words in a shape are set: its own size and alignment, in its stroke colour (ink when it has no outline). */
export const shapeText = (el: Shape, paint: { ink: string }) => ({
  fontSize: el.fontSize ?? NOTE_FONT_SIZE,
  align: el.textAlign ?? 'center',
  color: el.strokeWidth > 0 && el.strokeColor !== 'transparent' ? el.strokeColor : paint.ink,
  weight: 400,
});
type TextLook = ReturnType<typeof shapeText>;

/** Words wrapped into a box, aligned across it and centred down it, cut off at its edges. */
const writeInBox = (ctx: CanvasRenderingContext2D, text: string, box: { x: number; y: number; width: number; height: number }, look: TextLook, font: string, pad = NOTE_PADDING) => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.fillStyle = look.color;
  ctx.font = `${look.weight} ${look.fontSize}px ${font}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = look.align;
  const lineHeight = lineHeightFor(look.fontSize);
  const lines = wrapText(ctx, text, box.width - 2 * pad);
  const top = Math.max(box.y + pad, box.y + (box.height - lines.length * lineHeight) / 2);
  const x = look.align === 'center' ? box.x + box.width / 2 : look.align === 'right' ? box.x + box.width - pad : box.x + pad;
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * lineHeight));
  ctx.restore();
};

export const TABLE_FONT_SIZE = 16;
export const TABLE_PADDING = 8;
export const TABLE_HEAD_FILL = '#fbe7b0';

const drawTable = (ctx: CanvasRenderingContext2D, el: Shape, paint: Paint) => {
  const b = elementBounds(el);
  const cells = el.cells ?? [['']];
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(b.x, b.y, b.width, b.height);
  const head = tableCellBox(el, 0, 0);
  if (el.fillColor !== 'transparent') {
    ctx.fillStyle = el.fillColor;
    ctx.fillRect(b.x, b.y, b.width, head.height);
  }
  ctx.beginPath();
  for (let r = 0; r <= cells.length; r++) { const y = b.y + (b.height * r) / cells.length; ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.width, y); }
  for (let c = 0; c <= cells[0].length; c++) { const x = b.x + (b.width * c) / cells[0].length; ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.height); }
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = Math.max(1, el.strokeWidth);
  ctx.lineCap = 'square';
  ctx.stroke();
  const fontSize = el.fontSize ?? TABLE_FONT_SIZE;
  cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell) writeInBox(ctx, cell, tableCellBox(el, r, c), { fontSize, align: el.textAlign ?? 'left', color: paint.ink, weight: r === 0 ? 600 : 400 }, paint.font, TABLE_PADDING);
  }));
};

export const MINDMAP_FONT_SIZE = 16;
export const MINDMAP_PADDING = 16;

const drawMindmapNode = (ctx: CanvasRenderingContext2D, el: Shape, paint: Paint) => {
  const b = elementBounds(el);
  const root = !el.parent;
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.width, b.height, Math.min(b.height / 2, 24));
  ctx.fillStyle = root ? el.strokeColor : el.fillColor === 'transparent' ? '#ffffff' : el.fillColor;
  ctx.fill();
  ctx.lineWidth = Math.max(1, el.strokeWidth);
  ctx.strokeStyle = el.strokeColor;
  ctx.stroke();
  if (el.text) {
    writeInBox(ctx, el.text, b, { fontSize: el.fontSize ?? MINDMAP_FONT_SIZE, align: el.textAlign ?? 'center', color: root ? '#ffffff' : paint.ink, weight: root ? 600 : 500 }, paint.font, MINDMAP_PADDING);
  }
};

/** The branches between mind map nodes, drawn under everything. */
export const drawMindmapLinks = (ctx: CanvasRenderingContext2D, elements: WhiteboardElement[]) => {
  for (const link of mindmapLinks(elements)) {
    ctx.save();
    ctx.globalAlpha = link.opacity;
    ctx.beginPath();
    ctx.moveTo(link.from.x, link.from.y);
    ctx.bezierCurveTo(link.c1.x, link.c1.y, link.c2.x, link.c2.y, link.to.x, link.to.y);
    ctx.strokeStyle = link.color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
};

/** The box a mind map node needs for its words: one line up to a width, then wrapped. */
export const mindmapNodeSize = (text: string, fontSize: number, measure: (run: string) => number) => {
  const max = 320;
  const lines = text ? wrapWith(measure, text, max - 2 * MINDMAP_PADDING) : [''];
  const width = Math.min(max, Math.max(96, ...lines.map(line => measure(line) + 2 * MINDMAP_PADDING)));
  return { width: Math.ceil(width), height: Math.max(40, lines.length * lineHeightFor(fontSize) + 16) };
};

export const drawElement = (ctx: CanvasRenderingContext2D, el: WhiteboardElement, paint: Paint) => {
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (el.type === 'image') {
    const img = paint.images.get(el.src);
    if (img) ctx.drawImage(img, el.x, el.y, el.width, el.height);
  } else if (el.type === 'html') {
    ctx.beginPath();
    ctx.roundRect(el.x, el.y, el.width, el.height, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = PAGE_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(el.x, el.y + PAGE_BAR);
    ctx.lineTo(el.x + el.width, el.y + PAGE_BAR);
    ctx.stroke();
    ctx.fillStyle = paint.ink;
    ctx.font = `600 14px ${paint.font}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(el.title || 'HTML', el.x + 12, el.y + PAGE_BAR / 2, el.width - 24);
  } else if (el.type === 'stroke') {
    if (el.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      // A single click is a dot.
      if (el.points.length === 1) ctx.lineTo(el.points[0].x + 0.01, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
      ctx.strokeStyle = el.tool === 'eraser' ? paint.board : el.color;
      ctx.lineWidth = el.size;
      if (el.tool === 'marker') { ctx.globalAlpha *= MARKER_ALPHA; ctx.lineCap = 'butt'; }
      ctx.stroke();
    }
  } else if (el.type === 'line') {
    const pts = linePath(el);
    ctx.strokeStyle = el.strokeColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.setLineDash(dashFor(el.strokeStyle, el.strokeWidth));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    if (pts.length > 1) {
      if (el.endArrow) arrowhead(ctx, pts[pts.length - 1], pts[pts.length - 2], el.strokeWidth);
      if (el.startArrow) arrowhead(ctx, pts[0], pts[1], el.strokeWidth);
    }
    if (el.label) {
      const at = midpointOf(pts);
      ctx.font = `600 14px ${paint.font}`;
      const w = ctx.measureText(el.label).width + 20;
      ctx.beginPath();
      ctx.roundRect(at.x - w / 2, at.y - 12, w, 24, 12);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.fillStyle = paint.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(el.label, at.x, at.y + 1);
    }
  } else if (el.type === 'stamp') {
    drawStamp(ctx, el, paint);
  } else if (el.type === 'shape' && el.shapeType === 'note') {
    drawNote(ctx, el, paint);
  } else if (el.type === 'shape' && el.shapeType === 'section') {
    drawSection(ctx, el, paint);
  } else if (el.type === 'shape' && el.shapeType === 'task') {
    drawTask(ctx, el, paint);
  } else if (el.type === 'shape' && el.shapeType === 'table') {
    drawTable(ctx, el, paint);
  } else if (el.type === 'shape' && el.shapeType === 'mindmap') {
    drawMindmapNode(ctx, el, paint);
  } else if (el.type === 'text') {
    ctx.fillStyle = el.color;
    ctx.font = `${el.fontSize}px ${paint.font}`;
    ctx.textBaseline = 'top';
    const align = el.textAlign ?? 'left';
    ctx.textAlign = align;
    const x = align === 'center' ? el.x + el.width / 2 : align === 'right' ? el.x + el.width : el.x;
    el.text.split('\n').forEach((line, i) => ctx.fillText(line, x, el.y + i * lineHeightFor(el.fontSize)));
  } else {
    shapePath(ctx, el);
    if (el.fillColor !== 'transparent') {
      if (el.fillStyle === 'hachure' || el.fillStyle === 'cross-hatch') {
        hatch(ctx, el, el.fillStyle === 'cross-hatch');
        shapePath(ctx, el);
      } else {
        ctx.fillStyle = el.fillColor;
        ctx.fill();
      }
    }
    if (el.strokeWidth > 0) {
      ctx.lineWidth = el.strokeWidth;
      ctx.strokeStyle = el.strokeColor;
      ctx.setLineDash(dashFor(el.strokeStyle, el.strokeWidth));
      ctx.stroke();
    }
    if (el.text) writeInBox(ctx, el.text, elementBounds(el), shapeText(el, paint), paint.font);
  }
  ctx.restore();
};
