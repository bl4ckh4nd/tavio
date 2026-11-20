import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lingui/core/macro', () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, part, idx) => `${acc}${part}${values[idx] ?? ''}`, ''),
}));

import { OnboardingTour, type TourStep } from './OnboardingTour';

const VIEWPORT = { width: 800, height: 600 };
const TOOLTIP = { width: 320, height: 180 };

const STEPS: TourStep[] = [
  { targetId: 'docker-target', title: 'First', content: 'First step', position: 'right' },
];

/** jsdom reports zero-sized boxes; placement depends on real measurement. */
const stubMeasuredBox = (rect: Partial<DOMRect>) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: VIEWPORT.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: VIEWPORT.height });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0,
    right: TOOLTIP.width, bottom: TOOLTIP.height,
    width: TOOLTIP.width, height: TOOLTIP.height,
    ...rect,
    toJSON: () => ({}),
  } as DOMRect);
};

const mountTarget = (rect: Partial<DOMRect>) => {
  const target = document.createElement('div');
  target.id = 'docker-target';
  target.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    ...rect,
    toJSON: () => ({}),
  } as DOMRect);
  document.body.appendChild(target);
  return target;
};

const spotlightOf = () => document.querySelector<HTMLElement>('div[style*="9999px"]');
const tooltipOf = () => [...document.querySelectorAll<HTMLElement>('div[style*="width: 320px"]')].at(-1);

describe('OnboardingTour placement', () => {
  beforeEach(() => {
    // Real timers: `waitFor` and the tour's scroll-settle timer must both run.
    stubMeasuredBox({});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.getElementById('docker-target')?.remove();
  });

  it('scrolls the target into view before measuring, and positions the spotlight by transform only', async () => {
    const target = mountTarget({
      top: 500, left: 420, right: 620, bottom: 540, width: 200, height: 40, x: 420, y: 500,
    });

    render(<OnboardingTour steps={STEPS} isOpen onClose={() => {}} onComplete={() => {}} />);

    const scrollOptions = vi.mocked(window.scrollTo).mock.calls[0]?.[0] as ScrollToOptions;
    expect(scrollOptions?.behavior).toBe('smooth');
    // Target center (520) sits below the viewport midpoint (300): the page must
    // scroll down so placement is not computed from stale coordinates.
    expect(scrollOptions?.top).toBeGreaterThan(0);

    await waitFor(() => expect(spotlightOf()).not.toBeNull());
    const spotlight = spotlightOf()!;

    // Transform carries the position; width/height are static so step changes
    // never animate layout.
    expect(spotlight.style.transform).toBe('translate3d(412px, 492px, 0)');
    expect(spotlight.style.top).toBe('');
    expect(spotlight.style.left).toBe('');
    expect(spotlight.style.width).toBe('216px');
    expect(spotlight.style.height).toBe('56px');
    expect(target.isConnected).toBe(true);
  });

  it('points at the mobile target when the desktop one is hidden, and at the desktop one otherwise', async () => {
    const hidden = mountTarget({ top: 100, left: 100, right: 200, bottom: 140, width: 100, height: 40 });
    const mobile = mountTarget({ top: 500, left: 420, right: 620, bottom: 540, width: 200, height: 40 });
    mobile.id = 'docker-target-mobile';

    const { unmount } = render(<OnboardingTour steps={STEPS} isOpen onClose={() => {}} onComplete={() => {}} />);
    await waitFor(() => expect(spotlightOf()?.style.transform).toBe('translate3d(412px, 492px, 0)'));
    unmount();

    hidden.getClientRects = () => [{}] as unknown as DOMRectList;
    render(<OnboardingTour steps={STEPS} isOpen onClose={() => {}} onComplete={() => {}} />);
    await waitFor(() => expect(spotlightOf()?.style.transform).toBe('translate3d(92px, 92px, 0)'));
    mobile.remove();
  });

  it('clamps the tooltip inside the viewport when the target sits at the bottom-right edge', async () => {
    mountTarget({
      top: 570, left: 700, right: 790, bottom: 595, width: 90, height: 25, x: 700, y: 570,
    });

    render(<OnboardingTour steps={STEPS} isOpen onClose={() => {}} onComplete={() => {}} />);

    await waitFor(() => expect(tooltipOf()).toBeDefined());
    const tooltip = tooltipOf()!;

    // Positioned lets clamping resolve, so read the parsed inline values.
    const top = Number.parseFloat(tooltip.style.top);
    const left = Number.parseFloat(tooltip.style.left);

    expect(Number.isFinite(top)).toBe(true);
    expect(Number.isFinite(left)).toBe(true);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + TOOLTIP.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + TOOLTIP.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('traps focus, closes on Escape, and restores focus to the opener', async () => {
    mountTarget({ top: 100, left: 100, right: 200, bottom: 140, width: 100, height: 40 });
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    const opener = document.createElement('button');
    opener.textContent = 'Open tour';
    document.body.append(appRoot, opener);
    opener.focus();
    const onClose = vi.fn();

    render(<OnboardingTour steps={STEPS} isOpen onClose={onClose} onComplete={() => {}} />, { container: appRoot });

    const dialog = await screen.findByRole('dialog', { name: 'First' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close tour' })).toHaveFocus());
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(appRoot).toHaveAttribute('aria-hidden', 'true');
    expect(appRoot.inert).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();
    expect(opener).toHaveFocus();
    expect(appRoot).not.toHaveAttribute('aria-hidden');
    expect(appRoot.inert).toBe(false);
    opener.remove();
    appRoot.remove();
  });
});
