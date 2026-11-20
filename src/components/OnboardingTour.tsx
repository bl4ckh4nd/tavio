import React, { useState, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { createPortal } from 'react-dom';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button, IconButton } from './ui';

export interface TourStep {
  targetId: string;
  title: string;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

interface OnboardingTourProps {
  steps: TourStep[];
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PADDING = 8;
const VIEWPORT_MARGIN = 12;
const TOOLTIP_GAP = 12;
/** Smooth scrolling needs a settled frame before coordinates are trustworthy. */
const SCROLL_SETTLE_MS = 400;
const TOOLTIP_FALLBACK_SIZE = { width: 320, height: 180 };

// A target can sit in a layout that is hidden at this width; `${id}-mobile` is its counterpart there.
const findTarget = (id: string) => {
  const element = document.getElementById(id);
  if (element && element.getClientRects().length > 0) return element;
  return document.getElementById(`${id}-mobile`) ?? element;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ steps, isOpen, onClose, onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [tooltipSize, setTooltipSize] = useState(TOOLTIP_FALLBACK_SIZE);
  const [isReady, setIsReady] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Reset if closed/opened
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
      setIsReady(true);
    } else {
      setIsReady(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isReady) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById('root');
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute('aria-hidden', 'true');
    }

    const focusTimer = window.setTimeout(() => {
      const firstControl = tooltipRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      (firstControl ?? tooltipRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !tooltipRef.current) return;
      const focusable = [...tooltipRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hasAttribute('disabled'));
      if (focusable.length === 0) {
        event.preventDefault();
        tooltipRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      if (appRoot) {
        appRoot.inert = false;
        appRoot.removeAttribute('aria-hidden');
      }
      previousFocusRef.current?.focus();
    };
  }, [isOpen, isReady, onClose]);

  useEffect(() => {
    if (!isOpen || !isReady) return;
    const focusTimer = window.setTimeout(() => {
      const firstControl = tooltipRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      (firstControl ?? tooltipRef.current)?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [currentStep, isOpen, isReady]);

  // Scroll the target into place first, then measure once scrolling settles.
  useLayoutEffect(() => {
    if (!isOpen) return;

    const measure = () => {
      const element = findTarget(steps[currentStep].targetId);
      if (!element) {
        setTargetRect(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      setTargetRect({
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        right: rect.right + SPOTLIGHT_PADDING,
        bottom: rect.bottom + SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
      });
    };

    const onViewportChange = () => measure();
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const element = findTarget(steps[currentStep].targetId);
    if (element) {
      const rect = element.getBoundingClientRect();
      const centeredTop = rect.top + window.scrollY - (window.innerHeight - rect.height) / 2;
      window.scrollTo({ top: Math.max(0, centeredTop), behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    }

    measure();
    const settleTimer = window.setTimeout(measure, prefersReducedMotion ? 0 : SCROLL_SETTLE_MS);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [currentStep, isOpen, steps]);

  // Tooltip placement depends on the real rendered box, not an estimated height.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const element = tooltipRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setTooltipSize(prev =>
      prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }
    );
  });

  if (!isOpen || !isReady) return null;

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    setCurrentStep(prev => Math.max(0, prev - 1));
  };

  // Place the tooltip from its measured bounds, flipping and clamping into the viewport.
  const getTooltipStyle = (): React.CSSProperties => {
    const { width, height } = tooltipSize;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;

    if (!targetRect) {
      return {
        top: clamp((window.innerHeight - height) / 2, VIEWPORT_MARGIN, maxTop),
        left: clamp((window.innerWidth - width) / 2, VIEWPORT_MARGIN, maxLeft),
        width: `${Math.min(TOOLTIP_FALLBACK_SIZE.width, window.innerWidth - VIEWPORT_MARGIN * 2)}px`,
      };
    }

    const horizontalCenter = targetRect.left + targetRect.width / 2 - width / 2;
    const verticalCenter = targetRect.top + targetRect.height / 2 - height / 2;
    const fitsRight = targetRect.right + TOOLTIP_GAP + width <= window.innerWidth - VIEWPORT_MARGIN;
    const fitsLeft = targetRect.left - TOOLTIP_GAP - width >= VIEWPORT_MARGIN;
    const fitsBelow = targetRect.bottom + TOOLTIP_GAP + height <= window.innerHeight - VIEWPORT_MARGIN;
    const fitsAbove = targetRect.top - TOOLTIP_GAP - height >= VIEWPORT_MARGIN;

    let top = targetRect.bottom + TOOLTIP_GAP;
    let left = horizontalCenter;

    switch (step.position) {
      case 'right':
        if (fitsRight) {
          top = verticalCenter;
          left = targetRect.right + TOOLTIP_GAP;
        } else if (fitsLeft) {
          top = verticalCenter;
          left = targetRect.left - TOOLTIP_GAP - width;
        } else if (fitsBelow) {
          top = targetRect.bottom + TOOLTIP_GAP;
        } else if (fitsAbove) {
          top = targetRect.top - TOOLTIP_GAP - height;
        }
        break;
      case 'left':
        if (fitsLeft) {
          top = verticalCenter;
          left = targetRect.left - TOOLTIP_GAP - width;
        } else if (fitsRight) {
          top = verticalCenter;
          left = targetRect.right + TOOLTIP_GAP;
        } else if (fitsBelow) {
          top = targetRect.bottom + TOOLTIP_GAP;
        } else if (fitsAbove) {
          top = targetRect.top - TOOLTIP_GAP - height;
        }
        break;
      case 'top':
        if (fitsAbove) {
          top = targetRect.top - TOOLTIP_GAP - height;
        } else if (fitsBelow) {
          top = targetRect.bottom + TOOLTIP_GAP;
        }
        break;
      case 'bottom':
      default:
        if (!fitsBelow && fitsAbove) {
          top = targetRect.top - TOOLTIP_GAP - height;
        }
        break;
    }

    return {
      top: `${clamp(top, VIEWPORT_MARGIN, maxTop)}px`,
      left: `${clamp(left, VIEWPORT_MARGIN, maxLeft)}px`,
      width: `${Math.min(TOOLTIP_FALLBACK_SIZE.width, window.innerWidth - VIEWPORT_MARGIN * 2)}px`,
    };
  };

  const portalContent = (
    <div className="fixed inset-0 z-[100] overflow-hidden">
      {/* 
        Spotlight Effect:
        A massive box-shadow dims everything outside the target. Only the
        translate transform animates, so moving between steps never animates
        layout or paint of the surrounding interface.
      */}
      {targetRect && (
        <div
          className="absolute left-0 top-0 rounded-stock transition-transform duration-300 ease-standard pointer-events-none motion-reduce:transition-none"
          style={{
            width: targetRect.width,
            height: targetRect.height,
            transform: `translate3d(${targetRect.left}px, ${targetRect.top}px, 0)`,
            boxShadow: '0 0 0 9999px var(--color-scrim)',
            zIndex: 101, // Behind tooltip, above base backdrop
          }}
        />
      )}

      {/* Fallback backdrop if no target */}
      {!targetRect && <div className="absolute inset-0 bg-scrim z-[101]" />}

      {/* Tooltip */}
      <div
        key={currentStep}
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="stock stock--lift absolute z-[102] p-6"
        style={getTooltipStyle()}
      >
        <IconButton label={t`Close tour`} onClick={onClose} className="absolute right-2 top-2">
          <X className="icon" aria-hidden="true" />
        </IconButton>

        <div className="dash-tour__head">
          <h3 id={titleId} className="dash-tour__title">{step.title}</h3>
          <p id={descriptionId} className="text-sm text-ink-2">{step.content}</p>
        </div>

        <div className="dash-tour__foot">
          <span className="text-xs text-muted">
            <Trans>Step {currentStep + 1} of {steps.length}</Trans>
          </span>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button variant="ghost" size="sm" onClick={handlePrev}>
                <ChevronLeft className="icon" aria-hidden="true" />
                <Trans>Back</Trans>
              </Button>
            )}
            <Button size="sm" onClick={handleNext}>
              {isLast ? t`Finish` : t`Next`} {!isLast && <ChevronRight className="icon" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(portalContent, document.body);
};
