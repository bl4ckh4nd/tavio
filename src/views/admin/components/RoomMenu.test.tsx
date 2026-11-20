import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeRoom } from '../../../../tests/helpers/fixtures';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lingui/core/macro', () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, part, idx) => `${acc}${part}${values[idx] ?? ''}`, ''),
}));

import { RoomMenu } from './RoomMenu';

const setup = (hasNotes = true) => {
  const actions = { onViewNotes: vi.fn(), onCopyLink: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
  const room = makeRoom({ id: 'room-1' });
  render(<RoomMenu room={room} hasNotes={hasNotes} {...actions} />);
  const trigger = screen.getByRole('button', { name: 'More room actions' });
  return { actions, room, trigger };
};

describe('RoomMenu', () => {
  afterEach(cleanup);

  it('opens on the trigger, focuses the first item, and returns focus on Escape', () => {
    const { trigger } = setup();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('keeps notes in the menu, and disabled when the room has none', () => {
    const { actions, trigger } = setup(false);
    fireEvent.click(trigger);
    const notes = screen.getByRole('menuitem', { name: 'Notes' });
    expect(notes).toBeDisabled();
    fireEvent.click(notes);
    expect(actions.onViewNotes).not.toHaveBeenCalled();
  });

  it('skips the disabled item with the arrow keys', () => {
    const { trigger } = setup(false);
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveFocus();
  });

  it('runs the action with the room, closes, and puts focus back first', () => {
    const { actions, room, trigger } = setup();
    actions.onDelete.mockImplementation(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(actions.onDelete).toHaveBeenCalledWith(room);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the pointer goes down outside', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
