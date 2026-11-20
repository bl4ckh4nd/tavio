import { describe, expect, it } from 'vitest';
import { moveZoom, NO_ZOOM } from './pinchZoom';

const PHONE = { width: 374, height: 636 };
const WIDE = 16 / 9;

describe('moveZoom', () => {
  it('doubles the picture when the fingers move twice as far apart', () => {
    const next = moveZoom(NO_ZOOM, [{ x: -50, y: 0 }, { x: 50, y: 0 }], [{ x: -100, y: 0 }, { x: 100, y: 0 }], PHONE, WIDE);
    expect(next.scale).toBeCloseTo(2);
  });

  it('keeps the spot between the fingers under the fingers', () => {
    const next = moveZoom(NO_ZOOM, [{ x: 40, y: 0 }, { x: 80, y: 0 }], [{ x: 20, y: 0 }, { x: 100, y: 0 }], PHONE, WIDE);
    expect(next.scale).toBeCloseTo(2);
    expect(next.x).toBeCloseTo(-60);
  });

  it('stays between the whole picture and four times its size', () => {
    const fingersApart = [{ x: -10, y: 0 }, { x: 10, y: 0 }];
    const fingersFarApart = [{ x: -100, y: 0 }, { x: 100, y: 0 }];
    expect(moveZoom(NO_ZOOM, fingersFarApart, fingersApart, PHONE, WIDE)).toEqual(NO_ZOOM);
    expect(moveZoom(NO_ZOOM, fingersApart, fingersFarApart, PHONE, WIDE).scale).toBe(4);
  });

  it('does not move the whole picture with one finger', () => {
    expect(moveZoom(NO_ZOOM, [{ x: 0, y: 0 }], [{ x: 80, y: 40 }], PHONE, WIDE)).toEqual(NO_ZOOM);
  });

  it('pans with one finger only as far as the edge of the picture', () => {
    const zoomed = { scale: 2, x: 0, y: 0 };
    // 748 wide in a 374 stage leaves 187 each way; 420 high fits 636, so it cannot move up or down.
    expect(moveZoom(zoomed, [{ x: 0, y: 0 }], [{ x: 500, y: 300 }], PHONE, WIDE)).toEqual({ scale: 2, x: 187, y: 0 });
  });
});
