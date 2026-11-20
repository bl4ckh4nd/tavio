import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lingui/core/macro', () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce((result, part, index) => `${result}${part}${values[index] ?? ''}`, ''),
}));

import { formatTranscriptTime, TranscriptPanel, transcriptSegmentStart } from './TranscriptPanel';

describe('TranscriptPanel', () => {
  afterEach(() => cleanup());

  it('formats and seeks timestamped transcript segments', () => {
    expect(formatTranscriptTime(3723)).toBe('1:02:03');
    expect(transcriptSegmentStart({ startMs: 12_500 })).toBe(12.5);
    const onSeek = vi.fn();

    render(<TranscriptPanel transcript={{ status: 'completed', segments: [{ id: 'a', startMs: 12_500, text: 'Welcome' }] }} onSeek={onSeek} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seek to 0:12' }));

    expect(onSeek).toHaveBeenCalledWith(12.5);
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('says so when the transcript query failed', () => {
    render(<TranscriptPanel failed />);
    expect(screen.getByRole('alert')).toHaveTextContent('The transcript could not be loaded.');
  });

  it('shows processing and failure states without transcript text', () => {
    const { rerender } = render(<TranscriptPanel transcript={{ status: 'processing' }} />);
    expect(screen.getByText('The transcript will appear here when processing finishes.')).toBeInTheDocument();

    rerender(<TranscriptPanel transcript={{ status: 'failed', error: 'Provider unavailable' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable');
  });
});
