import { describe, expect, it } from 'vitest';
import { WHITEBOARD_MORE_SHAPES, type WhiteboardElement } from '../../types';
import { elementBounds, hitTest, linePath, moveElement, outlinePath, resizeElement, touchedByPath } from './geometry';

const rect = (over: Partial<Extract<WhiteboardElement, { type: 'shape' }>> = {}): WhiteboardElement => ({
  id: 'r', type: 'shape', shapeType: 'rectangle', x: 0, y: 0, width: 100, height: 50,
  strokeColor: '#18181b', fillColor: 'transparent', strokeWidth: 2, ...over,
});
const line: WhiteboardElement = {
  id: 'l', type: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], strokeColor: '#18181b', strokeWidth: 2, endArrow: true,
};
const pen: WhiteboardElement = {
  id: 'p', type: 'stroke', tool: 'pen', color: '#18181b', size: 4, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
};
const text: WhiteboardElement = { id: 't', type: 'text', x: 10, y: 20, width: 80, height: 24, text: 'Hallo', color: '#18181b', fontSize: 20 };

describe('whiteboard geometry', () => {
  it('measures every kind, including shapes drawn up and to the left', () => {
    expect(elementBounds(rect({ x: 100, y: 50, width: -100, height: -50 }))).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(elementBounds(line)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(elementBounds(pen)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    expect(elementBounds(text)).toEqual({ x: 10, y: 20, width: 80, height: 24 });
  });

  it('hits a line and a pen stroke only near what was drawn, not anywhere in their box', () => {
    expect(hitTest(line, { x: 50, y: 52 }, 4)).toBe(true);
    expect(hitTest(line, { x: 90, y: 10 }, 4)).toBe(false);
    expect(hitTest(pen, { x: 49, y: 25 }, 4)).toBe(true);
    expect(hitTest(pen, { x: 10, y: 40 }, 4)).toBe(false);
  });

  it('hits a diamond inside its four edges, not in the corners of its box', () => {
    const diamond = rect({ shapeType: 'diamond', width: 100, height: 100 });
    expect(hitTest(diamond, { x: 50, y: 50 }, 0)).toBe(true);
    expect(hitTest(diamond, { x: 5, y: 5 }, 0)).toBe(false);
    expect(hitTest(rect(), { x: 5, y: 5 }, 0)).toBe(true);
  });

  it.each(WHITEBOARD_MORE_SHAPES)('outlines a %s as one closed path inside its box, the same for the board and the file', kind => {
    const d = outlinePath(kind, { x: 10, y: 20, width: 200, height: 120 });
    expect(d).toMatch(/^M/);
    expect(d).toMatch(/Z/);
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = numbers.filter((_, i) => i % 2 === 0), ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 - 0.01);
    expect(Math.max(...xs)).toBeLessThanOrEqual(210 + 0.01);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20 - 0.01);
    expect(Math.max(...ys)).toBeLessThanOrEqual(140 + 0.01);
  });

  it('hits a triangle inside its edges, not in the empty corners at its top', () => {
    const triangle = rect({ shapeType: 'triangle', width: 100, height: 100 });
    expect(hitTest(triangle, { x: 50, y: 80 }, 0)).toBe(true);
    expect(hitTest(triangle, { x: 5, y: 5 }, 0)).toBe(false);
  });

  it('moves points and boxes, and a moved arrow lets go of what it pointed at', () => {
    const bound: WhiteboardElement = { ...line, start: { id: 'r', fx: 1, fy: 0.5 }, end: { id: 'x', fx: 0, fy: 0.5 } };
    const moved = moveElement(bound, 10, 5);
    expect(moved.type === 'line' && moved.points[1]).toEqual({ x: 110, y: 105 });
    expect(moved.type === 'line' && [moved.start, moved.end]).toEqual([undefined, undefined]);
    expect(moveElement(text, -10, 0)).toMatchObject({ x: 0, y: 20 });
  });

  it('resizes lines and pen strokes by scaling their points into the new box', () => {
    const resized = resizeElement(pen, { x: 0, y: 0, width: 100, height: 25 });
    expect(resized.type === 'stroke' && resized.points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 25 }]);
    expect(resizeElement(rect(), { x: 5, y: 5, width: 10, height: 20 })).toMatchObject({ x: 5, y: 5, width: 10, height: 20 });
  });

  it('finds what an eraser path touched, skipping locked elements', () => {
    const elements = [rect({ id: 'a' }), rect({ id: 'b', x: 500 }), { ...line, id: 'c', locked: true }];
    expect(touchedByPath(elements, [{ x: 50, y: 25 }, { x: 60, y: 25 }], 6)).toEqual(['a']);
  });
  it('hits a note anywhere on it, a section only on its edge or its name tab, so a drag inside a section selects what lies on it', () => {
    const note = rect({ shapeType: 'note', width: 200, height: 200 });
    expect(hitTest(note, { x: 190, y: 10 }, 0)).toBe(true);
    const section = rect({ shapeType: 'section', width: 600, height: 400, text: 'Ideen' });
    expect(hitTest(section, { x: 300, y: 200 }, 4)).toBe(false);
    expect(hitTest(section, { x: 300, y: 2 }, 4)).toBe(true);
    expect(hitTest(section, { x: 598, y: 200 }, 4)).toBe(true);
    expect(hitTest(section, { x: 20, y: -14 }, 4)).toBe(true);
  });

  it('routes an elbow connector at right angles out of the sides its ends sit on, and measures it by that route', () => {
    const elbow = (points: { x: number; y: number }[], over: Record<string, unknown> = {}) =>
      ({ ...line, points, elbow: true, ...over }) as WhiteboardElement & { type: 'line' };
    // Right edge of one box to the left edge of a box lower down: across, down the middle, across.
    const facing = elbow([{ x: 100, y: 25 }, { x: 300, y: 125 }], { start: { id: 'a', fx: 1, fy: 0.5 }, end: { id: 'b', fx: 0, fy: 0.5 } });
    expect(linePath(facing)).toEqual([{ x: 100, y: 25 }, { x: 200, y: 25 }, { x: 200, y: 125 }, { x: 300, y: 125 }]);
    // Bottom to bottom goes under both.
    const under = elbow([{ x: 50, y: 50 }, { x: 350, y: 70 }], { start: { id: 'a', fx: 0.5, fy: 1 }, end: { id: 'b', fx: 0.5, fy: 1 } });
    expect(linePath(under)).toEqual([{ x: 50, y: 50 }, { x: 50, y: 94 }, { x: 350, y: 94 }, { x: 350, y: 70 }]);
    // Out of a right edge into a top edge: one bend.
    const corner = elbow([{ x: 100, y: 25 }, { x: 300, y: 200 }], { start: { id: 'a', fx: 1, fy: 0.5 }, end: { id: 'b', fx: 0.5, fy: 0 } });
    expect(linePath(corner)).toEqual([{ x: 100, y: 25 }, { x: 300, y: 25 }, { x: 300, y: 200 }]);
    expect(elementBounds(under)).toEqual({ x: 50, y: 50, width: 300, height: 44 });
    expect(hitTest(under, { x: 200, y: 94 }, 3)).toBe(true);
    expect(hitTest(under, { x: 200, y: 60 }, 3)).toBe(false);
    // Facing edges closer than the room to turn: still straight across, no loop back through a box.
    const close = elbow([{ x: 162, y: 262 }, { x: 162, y: 282 }], { start: { id: 'a', fx: 0.5, fy: 1 }, end: { id: 'b', fx: 0.5, fy: 0 } });
    expect(linePath(close)).toEqual([{ x: 162, y: 262 }, { x: 162, y: 282 }]);
    // A straight line stays as drawn.
    expect(linePath(line as WhiteboardElement & { type: 'line' })).toBe((line as { points: unknown }).points);
  });

  it('hits a task card, a table and a mind map node anywhere in their box, corners included', () => {
    for (const shapeType of ['task', 'table', 'mindmap'] as const) expect(hitTest(rect({ shapeType }), { x: 2, y: 2 }, 0)).toBe(true);
    expect(hitTest(rect({ shapeType: 'diamond' }), { x: 2, y: 2 }, 0)).toBe(false);
  });
});
