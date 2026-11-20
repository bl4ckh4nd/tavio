import React from 'react';

export const ControlBtn: React.FC<{
  icon: React.ReactNode;
  onClick: () => void;
  /** The accessible name. The word under the icon falls back to it. */
  label: string;
  caption?: React.ReactNode;
  /** media: `.ctl--off` while not active. tool: `.ctl--open` while active. leave: `.ctl--leave`. */
  kind?: 'media' | 'tool' | 'leave';
  active?: boolean;
  pressed?: boolean;
  /** Set on a control that opens a menu: it reports aria-expanded instead of aria-pressed. */
  expanded?: boolean;
  badge?: number;
  className?: string;
  disabled?: boolean;
}> = ({ icon, onClick, label, caption, kind = 'tool', active, pressed, expanded, badge, className = '', disabled }) => {
  const state =
    kind === 'leave' ? 'ctl--leave'
    : kind === 'media' ? (active ? '' : 'ctl--off')
    : active ? 'ctl--open' : '';
  const isMenu = expanded !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`ctl relative ${state} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={isMenu || kind === 'leave' ? undefined : pressed ?? (kind === 'tool' ? !!active : undefined)}
      aria-haspopup={isMenu ? 'menu' : undefined}
      aria-expanded={expanded}
    >
      {icon}
      <span>{caption ?? label}</span>
      {badge !== undefined && badge > 0 && <span className="ctl__badge fig">{badge}</span>}
    </button>
  );
};
