// Where the others point on the board, sent over the call's data channel. Nothing of it is saved.

export const CURSOR_TOPIC = 'board-cursor';
const MAX_CHAT = 80;
const MAX_COORDINATE = 50000;
/** A cursor nobody moved for this long is gone: its owner closed the board or lost the connection. */
export const CURSOR_QUIET_MS = 5000;

export type CursorMessage = { x: number; y: number; chat?: string } | { hide: true };
export type LiveCursor = { name: string; x: number; y: number; chat?: string; at: number };

export const encodeCursor = (message: CursorMessage) => new TextEncoder().encode(JSON.stringify(message));

/** A message from another participant, or null when it is not one. The sender's name never comes from here. */
export const decodeCursor = (payload: Uint8Array): CursorMessage | null => {
  let data: any;
  try { data = JSON.parse(new TextDecoder().decode(payload)); } catch { return null; }
  if (data?.hide === true) return { hide: true };
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORDINATE;
  if (!ok(data?.x) || !ok(data?.y)) return null;
  const chat = typeof data.chat === 'string' && data.chat.trim() ? data.chat.slice(0, MAX_CHAT) : undefined;
  return chat ? { x: data.x, y: data.y, chat } : { x: data.x, y: data.y };
};

/** The cursors after one message: the sender's replaced or removed, the quiet ones dropped. */
export const liveCursors = (cursors: Record<string, LiveCursor>, from: string, name: string, message: CursorMessage, now: number) => {
  const next: Record<string, LiveCursor> = {};
  for (const [id, cursor] of Object.entries(cursors)) if (id !== from && now - cursor.at < CURSOR_QUIET_MS) next[id] = cursor;
  if (!('hide' in message)) next[from] = { name, x: message.x, y: message.y, ...(message.chat ? { chat: message.chat } : {}), at: now };
  return next;
};
