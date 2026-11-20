import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface Zoom {
  scale: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

const MAX_SCALE = 4;
// A finger rests a little while it taps; further than this it was moving the picture.
const TAP_SLOP = 8;

const centerOf = (points: Point[]): Point => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

const spreadOf = (points: Point[]) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);

/**
 * The next zoom after one or two fingers moved. Points are relative to the middle of the box, and the
 * picture is drawn whole inside the box, so it may only move as far as it sticks out of the box.
 */
export function moveZoom(zoom: Zoom, from: Point[], to: Point[], box: Size, aspect: number): Zoom {
  const ratio = from.length === 2 && to.length === 2 ? spreadOf(to) / (spreadOf(from) || 1) : 1;
  const scale = Math.min(MAX_SCALE, Math.max(1, zoom.scale * ratio));
  if (scale === 1) return NO_ZOOM;

  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  const pictureWidth = Math.min(box.width, box.height * aspect);
  const pictureHeight = pictureWidth / aspect;
  const maxX = Math.max(0, (pictureWidth * scale - box.width) / 2);
  const maxY = Math.max(0, (pictureHeight * scale - box.height) / 2);
  const clamp = (value: number, max: number) => Math.min(max, Math.max(-max, value)) + 0;
  return {
    scale,
    x: clamp(toCenter.x - (fromCenter.x - zoom.x) * (scale / zoom.scale), maxX),
    y: clamp(toCenter.y - (fromCenter.y - zoom.y) * (scale / zoom.scale), maxY),
  };
}

/** Pinch and pan with touch. Handlers belong on the tile; `transform` belongs on its video. */
export function usePinchZoom(enabled: boolean) {
  const [zoom, setZoom] = useState(NO_ZOOM);
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const travelled = useRef(0);

  const reset = useCallback(() => setZoom(NO_ZOOM), []);
  useEffect(() => {
    if (!enabled) {
      pointers.current.clear();
      setZoom(NO_ZOOM);
    }
  }, [enabled]);

  if (!enabled) return { zoomed: false, transform: undefined, reset, handlers: undefined };

  const release = (event: React.PointerEvent) => { pointers.current.delete(event.pointerId); };
  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') return;
      if (pointers.current.size === 0) {
        moved.current = false;
        travelled.current = 0;
      }
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const before = pointers.current.get(event.pointerId);
      if (!before) return;
      const from = [...pointers.current.values()].slice(0, 2);
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const to = [...pointers.current.values()].slice(0, 2);
      travelled.current += Math.hypot(event.clientX - before.x, event.clientY - before.y);
      if (travelled.current > TAP_SLOP || pointers.current.size > 1) moved.current = true;

      const rect = event.currentTarget.getBoundingClientRect();
      const video = event.currentTarget.querySelector('video');
      const aspect = video?.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
      const fromMiddle = (point: Point) => ({ x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 });
      setZoom((current) => moveZoom(current, from.map(fromMiddle), to.map(fromMiddle), rect, aspect));
    },
    onPointerUp: release,
    onPointerCancel: release,
    // The finger that moved the picture must not also count as a tap on the tile.
    onClickCapture: (event: React.MouseEvent) => {
      if (!moved.current) return;
      moved.current = false;
      event.stopPropagation();
      event.preventDefault();
    },
  };

  return {
    zoomed: zoom.scale > 1,
    transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
    reset,
    handlers,
  };
}
