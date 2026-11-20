import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, liveCursors } from './boardCursors';

describe('board cursors', () => {
  it('sends a position and an optional short sentence, and reads back only well-formed ones', () => {
    expect(decodeCursor(encodeCursor({ x: 12.5, y: -40, chat: 'Hier!' }))).toEqual({ x: 12.5, y: -40, chat: 'Hier!' });
    expect(decodeCursor(encodeCursor({ x: 1, y: 2 }))).toEqual({ x: 1, y: 2 });
    expect((decodeCursor(encodeCursor({ x: 1, y: 2, chat: 'x'.repeat(500) })) as { chat?: string }).chat).toHaveLength(80);
    expect(decodeCursor(new TextEncoder().encode('{"x":"1","y":2}'))).toBeNull();
    expect(decodeCursor(new TextEncoder().encode('{"x":1e9,"y":2}'))).toBeNull();
    expect(decodeCursor(new TextEncoder().encode('kein json'))).toBeNull();
    expect(decodeCursor(new TextEncoder().encode('{"hide":true}'))).toEqual({ hide: true });
  });

  it('shows each person once, under the name from the call, and forgets a cursor that went quiet or left', () => {
    let cursors = liveCursors({}, 'p1', 'Sara', { x: 1, y: 2 }, 1000);
    cursors = liveCursors(cursors, 'p2', 'Jonas', { x: 5, y: 5, chat: 'Hallo' }, 2000);
    cursors = liveCursors(cursors, 'p1', 'Sara', { x: 3, y: 4 }, 3000);
    expect(cursors).toEqual({
      p1: { name: 'Sara', x: 3, y: 4, at: 3000 },
      p2: { name: 'Jonas', x: 5, y: 5, chat: 'Hallo', at: 2000 },
    });
    expect(Object.keys(liveCursors(cursors, 'p2', 'Jonas', { hide: true }, 4000))).toEqual(['p1']);
    expect(Object.keys(liveCursors(cursors, 'p1', 'Sara', { x: 0, y: 0 }, 9000))).toEqual(['p1']);
  });
});
