import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/BrandMark', () => ({ BrandMark: () => null }));
vi.mock('../components/ToastProvider', () => ({ useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }) }));

import { Docs } from './Docs';

const search = () => screen.getByRole('searchbox');

describe('Docs', () => {
  const writeText = vi.fn(async (_text: string) => undefined);
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    scrollIntoView.mockClear();
    toastError.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<Docs onNavigate={vi.fn()} />);
  });
  afterEach(cleanup);

  it('states the licence the repository has', () => {
    expect(document.body).toHaveTextContent('FSL-1.1-ALv2');
    expect(document.body).not.toHaveTextContent('MIT');
  });

  it('copies exactly what each code block shows', async () => {
    const blocks = [...document.querySelectorAll('pre')];
    expect(blocks.length).toBeGreaterThan(1);

    for (const block of blocks) {
      fireEvent.click(block.parentElement!.querySelector('button')!);
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(block.textContent));
    }
  });

  it('tells the reader what to do when copying fails', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));

    fireEvent.click(document.querySelector('pre')!.parentElement!.querySelector('button')!);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not copy. Select the text instead.'));
  });

  it('finds sections by what they show and opens the first with Enter', () => {
    fireEvent.change(search(), { target: { value: 'STRIPE reports' } });
    expect(document.querySelector('.menu')).toHaveTextContent('Webhooks');

    fireEvent.keyDown(search(), { key: 'Enter' });

    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('webhooks'));
    expect(search()).toHaveValue('');
  });

  it('says when nothing matches and clears on Escape', () => {
    fireEvent.change(search(), { target: { value: 'kubernetes operator' } });
    expect(screen.getByRole('status')).toHaveTextContent('No results');

    fireEvent.keyDown(search(), { key: 'Escape' });

    expect(search()).toHaveValue('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('focuses the search with the shortcut', () => {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(search()).toHaveFocus();
  });
});
