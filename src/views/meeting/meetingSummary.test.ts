import { describe, expect, it } from 'vitest';
import { buildMeetingSummary, formatMeetingDuration } from './meetingSummary';

describe('buildMeetingSummary', () => {
  it('deduplicates and sorts participants and derives the duration', () => {
    const summary = buildMeetingSummary({
      roomName: 'Weekly Sync',
      roomSlug: 'weekly',
      startedAt: 1_000,
      endedAt: 91_000,
      participantNames: ['Zoe', 'Ada', 'Zoe', '  ', 'Ada '],
      chatMessageCount: 4,
      hadNotes: true,
      hadRecording: false,
      reason: 'host_ended',
    });

    expect(summary.durationMs).toBe(90_000);
    expect(summary.participantNames).toEqual(['Ada', 'Zoe']);
    expect(summary.roomName).toBe('Weekly Sync');
    expect(summary.reason).toBe('host_ended');
  });

  it('takes the task cards on the board, open ones first, and nothing else from it', () => {
    const card = (id: string, text: string, more: Record<string, unknown> = {}) => ({
      id, type: 'shape', shapeType: 'task', x: 0, y: 0, width: 280, height: 150, text, strokeColor: 'transparent', fillColor: '#ffffff', strokeWidth: 0, ...more,
    });
    const summary = buildMeetingSummary({
      startedAt: 0,
      endedAt: 1,
      board: [
        card('a', 'Send the figures', { done: true }),
        card('b', 'Test the recording', { owner: 'Jonas', due: '2026-11-20' }),
        card('c', '   '),
        { id: 'n', type: 'shape', shapeType: 'note', x: 0, y: 0, width: 200, height: 200, text: 'Not a task', strokeColor: 'transparent', fillColor: '#fbe7b0', strokeWidth: 0 },
      ] as any,
    });

    expect(summary.tasks).toEqual([
      { text: 'Test the recording', owner: 'Jonas', due: '2026-11-20', done: false },
      { text: 'Send the figures', done: true },
    ]);
  });

  it('falls back to the slug and never reports a negative duration', () => {
    const summary = buildMeetingSummary({ roomSlug: 'standup', startedAt: 5_000, endedAt: 1_000 });

    expect(summary.roomName).toBe('standup');
    expect(summary.durationMs).toBe(0);
    expect(summary.participantNames).toEqual([]);
    expect(summary.chatMessageCount).toBe(0);
    expect(summary.reason).toBe('left');
  });
});

describe('formatMeetingDuration', () => {
  it('drops the hour segment below one hour', () => {
    expect(formatMeetingDuration(90_000)).toBe('01:30');
  });

  it('keeps the hour segment above one hour', () => {
    expect(formatMeetingDuration(3_723_000)).toBe('1:02:03');
  });
});
