import { useEffect, type RefObject } from 'react';

const STILL = '(prefers-reduced-motion: reduce)';

/**
 * Lays each `[data-lay]` element in the scope down once, when it comes into view.
 * Elements wait only while the observer runs: without it, nothing is ever hidden.
 */
export function useLayDown(scope: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = scope.current;
    if (!root || typeof IntersectionObserver === 'undefined' || matchMedia(STILL).matches) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.lay = 'in';
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.2 });
    for (const item of root.querySelectorAll<HTMLElement>('[data-lay]')) {
      if (item.dataset.lay === 'in') continue;
      item.dataset.lay = 'wait';
      observer.observe(item);
    }
    return () => observer.disconnect();
  }, [scope]);
}

/**
 * Hands the pointer's place over `area` to `pile` as --px and --py (-1 to 1), once per frame.
 * Only for fine pointers and when motion is welcome; the CSS turns them into each layer's drift.
 */
export function usePileDepth(area: RefObject<HTMLElement | null>, pile: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const zone = area.current;
    const target = pile.current;
    if (!zone || !target) return;
    const query = matchMedia(`(pointer: fine) and (prefers-reduced-motion: no-preference)`);
    let frame = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      frame = 0;
      target.style.setProperty('--px', x.toFixed(3));
      target.style.setProperty('--py', y.toFixed(3));
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const clamp = (n: number) => Math.max(-1, Math.min(1, n));
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const box = zone.getBoundingClientRect();
      x = clamp(((event.clientX - box.left) / box.width) * 2 - 1);
      y = clamp(((event.clientY - box.top) / box.height) * 2 - 1);
      queue();
    };
    const rest = () => { x = 0; y = 0; queue(); };
    const listen = () => {
      zone.removeEventListener('pointermove', move);
      zone.removeEventListener('pointerleave', rest);
      if (!query.matches) { rest(); return; }
      zone.addEventListener('pointermove', move);
      zone.addEventListener('pointerleave', rest);
    };
    listen();
    query.addEventListener('change', listen);
    return () => {
      query.removeEventListener('change', listen);
      zone.removeEventListener('pointermove', move);
      zone.removeEventListener('pointerleave', rest);
      cancelAnimationFrame(frame);
      target.style.removeProperty('--px');
      target.style.removeProperty('--py');
    };
  }, [area, pile]);
}
