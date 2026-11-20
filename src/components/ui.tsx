
import { t } from '@lingui/core/macro';
import React, { useId } from 'react';
import { ChevronDown, CircleAlert, X } from 'lucide-react';

// --- Button ---
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
}

const BUTTON_VARIANTS = {
  primary: 'btn--ink',
  secondary: 'btn--card',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
  outline: 'btn--card',
};

const BUTTON_SIZES = {
  sm: 'btn--s',
  md: '',
  lg: 'btn--l',
  icon: 'btn--icon',
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading,
  className = '',
  disabled,
  ...props
}) => (
  <button
    className={`btn ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
    disabled={disabled || isLoading}
    {...props}
  >
    {isLoading ? <span className="spin" aria-hidden="true" /> : null}
    {children}
  </button>
);

// --- IconButton ---
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  onBoard?: boolean;
  isOn?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({ label, onBoard, isOn, className = '', children, ...props }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`icon-btn ${onBoard ? 'icon-btn--board' : ''} ${isOn ? 'is-on' : ''} ${className}`}
    {...props}
  >
    {children}
  </button>
);

// --- Input ---
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({ label, error, helperText, leftIcon, rightIcon, className = '', id: idProp, ...props }) => {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  return (
    <div className="field w-full">
      {label && <label htmlFor={id} className="field__label">{label}</label>}
      <div className="relative">
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted">
            {leftIcon}
          </div>
        )}
        <input
          id={id}
          className={`input ${leftIcon ? 'pl-10' : ''} ${rightIcon ? 'pr-10' : ''} ${error ? 'input--error' : ''} ${className}`}
          aria-describedby={error ? `${id}-error` : helperText ? `${id}-helper` : undefined}
          aria-invalid={error ? 'true' : undefined}
          {...props}
        />
        {rightIcon && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
            {rightIcon}
          </div>
        )}
      </div>
      {helperText && !error && <p id={`${id}-helper`} className="field__help">{helperText}</p>}
      {error && <p id={`${id}-error`} role="alert" className="field__help field__help--error">{error}</p>}
    </div>
  );
};

// --- Select ---
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select: React.FC<SelectProps> = ({ label, error, className = '', children, id: idProp, ...props }) => {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  return (
    <div className="field w-full">
      {label && <label htmlFor={id} className="field__label">{label}</label>}
      <div className="relative">
        <select
          id={id}
          className={`input ${error ? 'input--error' : ''} ${className}`}
          {...props}
        >
          {children}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted">
          <ChevronDown className="icon" aria-hidden="true" />
        </div>
      </div>
      {error && <p className="field__help field__help--error">{error}</p>}
    </div>
  );
};

// --- Groove ---
interface GrooveOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

interface GrooveProps<T extends string> {
  options: GrooveOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  wide?: boolean;
  onBoard?: boolean;
  className?: string;
}

export const Groove = <T extends string>({ options, value, onChange, ariaLabel, wide, onBoard, className = '' }: GrooveProps<T>) => (
  <div role="group" aria-label={ariaLabel} className={`groove ${wide ? 'groove--wide' : ''} ${onBoard ? 'groove--board' : ''} ${className}`}>
    {options.map(option => (
      <button
        key={option.value}
        type="button"
        aria-pressed={option.value === value}
        className={`groove__opt ${option.value === value ? 'is-on' : ''}`}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

// --- Switch ---
interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, className = '', ...props }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`switch ${className}`}
    onClick={() => onChange(!checked)}
    {...props}
  >
    <span />
  </button>
);

// --- Card ---
export const Card: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`sheet ${className}`}>
    {children}
  </div>
);

// --- Tag ---
export const Tag: React.FC<{ children: React.ReactNode; variant?: 'outline' | 'live' | 'quiet' | 'board'; className?: string }> = ({ children, variant = 'outline', className = '' }) => (
  <span className={`tag tag--${variant} ${className}`}>
    {children}
  </span>
);

// --- Badge ---
// Status is an ink outline with a word, so every variant reads the same. The word carries the meaning.
export const Badge: React.FC<{ children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'neutral'; className?: string }> = ({ children, className = '' }) => (
  <Tag className={className}>{children}</Tag>
);

// --- Stamp ---
// Coral means saved: this is the one place it fills a word.
export const Stamp: React.FC<{ children: React.ReactNode; size?: 's' | 'md' | 'l'; className?: string }> = ({ children, size = 'md', className = '' }) => (
  <span className={`stampwrap ${className}`}>
    <span className={`stamp ${size === 'md' ? '' : `stamp--${size}`}`}>{children}</span>
  </span>
);

// --- MeetingRecord ---
// A meeting written down: the signature on the desk at the end of a call.
interface MeetingRecordProps {
  title: React.ReactNode;
  /** When it took place: one line in the outlier face under the title. */
  when?: React.ReactNode;
  names?: React.ReactNode;
  rows?: { label: React.ReactNode; value: React.ReactNode }[];
  stamp?: React.ReactNode;
  large?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const MeetingRecord: React.FC<MeetingRecordProps> = ({ title, when, names, rows = [], stamp, large, className = '', children }) => (
  <article className={`record stock stock--lift ${large ? 'record--l' : ''} ${className}`}>
    <p className="record__title">{title}</p>
    {when ? <p className="record__when">{when}</p> : null}
    {names ? <p className="record__names">{names}</p> : null}
    {rows.length > 0 ? (
      <div className="record__rows">
        {rows.map((row, index) => (
          <div key={index} className="record__row">
            <span>{row.label}</span>
            <span className="fig">{row.value}</span>
          </div>
        ))}
      </div>
    ) : null}
    {children}
    {stamp ? <div className="mt-3.5"><Stamp size={large ? 'l' : 'md'}>{stamp}</Stamp></div> : null}
  </article>
);

// --- Notice ---
interface NoticeProps {
  children: React.ReactNode;
  variant?: 'info' | 'error';
  action?: React.ReactNode;
  className?: string;
}

export const Notice: React.FC<NoticeProps> = ({ children, variant = 'info', action, className = '' }) => (
  <div role={variant === 'error' ? 'alert' : undefined} className={`notice ${variant === 'error' ? 'notice--error' : ''} ${className}`}>
    {variant === 'error' ? <CircleAlert className="icon mt-0.5" aria-hidden="true" /> : null}
    <div className="min-w-0 flex-1">{children}</div>
    {action}
  </div>
);

// --- Skeleton ---
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div aria-hidden="true" className={`skel ${className}`} />
);

// --- Avatar ---
export const Avatar: React.FC<{ name: string; src?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }> = ({ name, src, size = 'md', className = '' }) => {
  const sizes = {
    sm: "!h-8 !w-8 text-xs",
    md: "!h-10 !w-10 text-sm",
    lg: "!h-12 !w-12 text-base",
    xl: "!h-20 !w-20 text-2xl"
  };

  const initials = name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={`avatar ${sizes[size]} ${className}`}>
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
};

// --- Drawer ---
interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
}

// --- Modal ---
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  closeOnBackdrop?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  ariaLabel,
  className = '',
  closeOnBackdrop = true,
}) => {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const el = modalRef.current;
    if (el) {
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusable[0]?.focus();
    }

    return () => {
      document.body.style.overflow = '';
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = modalRef.current;
      if (!el) return;
      const focusable = [...el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )].filter(n => !n.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 entry-fade">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        onClick={() => {
          if (closeOnBackdrop) onClose();
        }}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`stock stock--lift relative w-full max-w-md entry-pop ${className}`}
      >
        {children}
      </div>
    </div>
  );
};

export const Drawer: React.FC<DrawerProps> = ({ isOpen, onClose, children, title }) => {
  const drawerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      // Focus the first focusable element in the drawer
      const el = drawerRef.current;
      if (el) {
        const focusable = el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        focusable[0]?.focus();
      }
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Trap focus inside drawer
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const el = drawerRef.current;
      if (!el) return;
      const focusable = [...el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )].filter(n => !n.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-scrim z-50 entry-fade"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className="stock stock--lift fixed bottom-0 left-0 right-0 rounded-b-none z-50 max-h-[85vh] flex flex-col entry-drawer"
      >
        <div className="flex justify-center py-3 border-b border-rule">
          <div className="w-10 h-1 bg-rule-2 rounded-full" />
        </div>
        {title && (
          <div className="pl-6 pr-3 py-2 border-b border-rule flex items-center justify-between">
            <h3 className="panel__title">{title}</h3>
            <IconButton label={t`Close`} onClick={onClose}>
              <X className="icon" aria-hidden="true" />
            </IconButton>
          </div>
        )}
        <div className="overflow-y-auto flex-1 p-6">
          {children}
        </div>
      </div>
    </>
  );
};
