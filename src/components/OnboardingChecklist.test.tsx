import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lingui/core/macro', () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, part, idx) => `${acc}${part}${values[idx] ?? ''}`, ''),
}));

import { OnboardingChecklist, type ChecklistItem } from './OnboardingChecklist';

describe('OnboardingChecklist controls', () => {
  afterEach(cleanup);

  const items = (overrides: Partial<ChecklistItem> = {}): ChecklistItem[] => [
    { id: 'create-room', label: 'Create a room', isCompleted: false, action: vi.fn(), ...overrides },
    { id: 'invite-team', label: 'Invite your team', isCompleted: true },
  ];

  it('exposes expansion and dismissal as keyboard-activatable native buttons', () => {
    const onDismiss = vi.fn();
    render(<OnboardingChecklist items={items()} onDismiss={onDismiss} title="Get Started" />);

    const toggle = screen.getByRole('button', { name: /Get Started/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const bodyId = toggle.getAttribute('aria-controls');
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(bodyId!)).not.toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(bodyId!)?.hidden).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss checklist' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('runs an incomplete item action but never re-fires a completed one', () => {
    const action = vi.fn();
    render(
      <OnboardingChecklist
        items={[items({ action })[0], items()[1]]}
        onDismiss={() => {}}
        title="Get Started"
      />
    );

    const openItem = screen.getByRole('button', { name: /Create a room/ });
    fireEvent.click(openItem);
    expect(action).toHaveBeenCalledTimes(1);

    const doneItem = screen.getByRole('button', { name: /Invite your team/ });
    expect(doneItem).toBeDisabled();
    fireEvent.click(doneItem);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
