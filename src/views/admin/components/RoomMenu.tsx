import { t } from '@lingui/core/macro';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { Copy, FileText, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Room } from '../../../types';

export type RoomMenuActions = {
  onViewNotes: (room: Room) => void;
  onCopyLink: (room: Room) => void;
  onEdit: (room: Room) => void;
  onDelete: (room: Room) => void;
};

type RoomMenuProps = RoomMenuActions & {
  room: Room;
  hasNotes: boolean;
};

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 4;

export const RoomMenu: React.FC<RoomMenuProps> = ({ room, hasNotes, onViewNotes, onCopyLink, onEdit, onDelete }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Fixed to the viewport, because a row near the bottom edge or a narrow phone would otherwise cut the menu off.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;
    const triggerBox = trigger.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const below = triggerBox.bottom + TRIGGER_GAP;
    const fitsBelow = below + menuBox.height <= window.innerHeight - VIEWPORT_MARGIN;
    const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, triggerBox.top - TRIGGER_GAP - menuBox.height);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(triggerBox.right - menuBox.width, window.innerWidth - menuBox.width - VIEWPORT_MARGIN));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    const onViewportChange = () => close();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [open, close]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  // Focus goes back first, so a dialog opened by the action records the trigger as the place to return to.
  const run = (action: (room: Room) => void) => () => {
    close(true);
    action(room);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--ghost btn--icon"
        aria-label={t`More room actions`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <MoreHorizontal className="icon" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t`More room actions`}
          className="menu stock stock--lift"
          style={{ position: 'fixed', zIndex: 'var(--z-dropdown)' }}
          onKeyDown={handleMenuKeyDown}
        >
          <button type="button" role="menuitem" className="menu__item" onClick={run(onCopyLink)}>
            <Copy className="icon" aria-hidden="true" /><span><Trans>Copy</Trans></span>
          </button>
          <button type="button" role="menuitem" className="menu__item" disabled={!hasNotes} onClick={run(onViewNotes)}>
            <FileText className="icon" aria-hidden="true" /><span><Trans>Notes</Trans></span>
          </button>
          <button type="button" role="menuitem" className="menu__item" onClick={run(onEdit)}>
            <Pencil className="icon" aria-hidden="true" /><span><Trans>Edit</Trans></span>
          </button>
          <button type="button" role="menuitem" className="menu__item menu__item--danger" onClick={run(onDelete)}>
            <Trash2 className="icon" aria-hidden="true" /><span><Trans>Delete</Trans></span>
          </button>
        </div>
      )}
    </>
  );
};
