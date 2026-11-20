import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ChatPopoverProps {
  label: string;
  onClose: () => void;
  /** Opens next to this element, on the body, so the scrolling message list cannot clip it. */
  anchor?: HTMLElement | null;
  className?: string;
  children: React.ReactNode;
}

const GAP = 4;
const MARGIN = 8;

// A small sheet above the composer or beside a message. Escape and a press outside close it
// without closing the side panel, and focus goes back to the control that opened it.
export const ChatPopover: React.FC<ChatPopoverProps> = ({ label, onClose, anchor, className = '', children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [position, setPosition] = useState<React.CSSProperties | undefined>(anchor ? { visibility: 'hidden' } : undefined);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current && !ref.current.contains(target) && !(target as Element).closest?.('[data-popover-trigger]')) {
        onCloseRef.current();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      const active = document.activeElement;
      if (!active || active === document.body) opener?.focus?.();
    };
  }, []);

  // Below the anchor when it fits, otherwise above; kept inside the window.
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const box = anchor.getBoundingClientRect();
      const sheet = ref.current?.getBoundingClientRect();
      if (!sheet) return;
      const below = box.bottom + GAP;
      const top = below + sheet.height + MARGIN <= window.innerHeight ? below : Math.max(MARGIN, box.top - GAP - sheet.height);
      const left = Math.min(Math.max(MARGIN, box.right - sheet.width), window.innerWidth - sheet.width - MARGIN);
      setPosition({ position: 'fixed', top, left });
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  const sheet = (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`chat-pop stock stock--lift ${className}`}
      style={position}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
  return anchor ? createPortal(sheet, document.body) : sheet;
};
