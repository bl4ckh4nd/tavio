import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Check, CircleAlert, Info, type LucideIcon } from 'lucide-react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ToastVariant = 'success' | 'error' | 'info';

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

// Convex reports server errors as "[CONVEX M(fn)] [Request ID: …] Server Error\nUncaught Error: <text>\n    at …".
// Show only <text>; production deployments omit it, so fall back to a generic message.
export const toUserFacingError = (message: string) => {
  if (!message.startsWith('[CONVEX')) return message;
  return message.match(/Uncaught (?:Convex)?Error: ([^\n]+)/)?.[1].trim() || t`Something went wrong. Please try again.`;
};

type ToastContextValue = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export const TOAST_TIMEOUT_MS = 3500;
/** Exit is deliberately faster than entry so dismissal feels responsive. */
export const TOAST_EXIT_MS = 150;

const ICONS: Record<ToastVariant, LucideIcon> = {
  success: Check,
  error: CircleAlert,
  info: Info,
};

const Toast: React.FC<{ toast: ToastItem; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(document.visibilityState === 'hidden');
  const remainingRef = useRef(TOAST_TIMEOUT_MS);
  const isPaused = isHovered || hasFocus || documentHidden;
  const Icon = ICONS[toast.variant];

  useEffect(() => {
    const onVisibilityChange = () => setDocumentHidden(document.visibilityState === 'hidden');
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (isExiting || isPaused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => setIsExiting(true), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [isExiting, isPaused]);

  useEffect(() => {
    if (!isExiting) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [isExiting, onDismiss, toast.id]);

  return (
    <div
      className={`toast stock stock--lift pointer-events-auto py-1.5 pr-2 transition-[transform,opacity] duration-150 ease-standard motion-reduce:transition-none ${toast.variant === 'error' ? 'text-error' : ''} ${hasEntered ? '' : 'entry-rise-sm'} ${isExiting ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100'}`}
      role={toast.variant === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      onAnimationEnd={() => setHasEntered(true)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setHasFocus(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false);
      }}
    >
      <Icon className="icon" aria-hidden="true" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{toast.message}</span>
      <button
        type="button"
        className="btn btn--ghost btn--s"
        onClick={() => setIsExiting(true)}
      >
        <Trans>Dismiss</Trans>
      </button>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const pushToast = useCallback((variant: ToastVariant, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(prev => [...prev, { id, message, variant }]);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    success: message => pushToast('success', message),
    error: message => pushToast('error', toUserFacingError(message)),
    info: message => pushToast('info', message),
  }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-(--z-toast) flex w-[92vw] max-w-sm flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
};
