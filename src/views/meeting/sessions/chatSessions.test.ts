import { describe, expect, it } from 'vitest';
import { splitChatBySession } from './chatSessions';

const at = (timestamp: number) => ({ id: `m-${timestamp}`, timestamp });
const info = {
  current: { id: 's-3', startedAt: 500 },
  currentFrom: 400,
  earlier: [
    { id: 's-1', startedAt: 100, until: 180 },
    { id: 's-2', startedAt: 300, until: 400 },
  ],
};

describe('the chat divided by session', () => {
  it('leaves the chat whole while the room has no sessions to tell apart', () => {
    const messages = [at(1), at(2)];
    expect(splitChatBySession(messages, undefined)).toEqual({ earlier: [], current: messages, currentStartedAt: null });
  });

  it('puts every message with the session it was written in', () => {
    const split = splitChatBySession([at(120), at(150), at(320), at(510), at(520)], info);
    expect(split.earlier.map(group => [group.key, group.messages.map(m => m.timestamp)])).toEqual([
      ['s-1', [120, 150]],
      ['s-2', [320]],
    ]);
    expect(split.current.map(m => m.timestamp)).toEqual([510, 520]);
    expect(split.currentStartedAt).toBe(500);
  });

  it('counts what someone wrote alone before the meeting as part of it', () => {
    const split = splitChatBySession([at(450), at(510)], info);
    expect(split.current.map(m => m.timestamp)).toEqual([450, 510]);
    expect(split.currentStartedAt).toBe(450);
  });

  it('attaches a message written between two sessions to the later one, and keeps older ones together', () => {
    const split = splitChatBySession([at(50), at(250)], { ...info, earlier: [{ id: 's-2', startedAt: 300, until: 400 }] });
    expect(split.earlier).toEqual([{ key: 's-2', startedAt: 300, messages: [at(50), at(250)] }]);

    const beyond = splitChatBySession([at(50)], { ...info, earlier: [] });
    expect(beyond.earlier).toEqual([{ key: 'older', startedAt: 50, messages: [at(50)] }]);
  });

  it('dates no line when nothing was written yet in this session', () => {
    expect(splitChatBySession([at(120)], info).currentStartedAt).toBeNull();
  });
});
