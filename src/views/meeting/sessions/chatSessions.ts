/**
 * How the chat is divided: what belongs to "now", and what earlier sessions left.
 * A message belongs to a session by its time; nothing is stored on the message for it.
 */
export type ChatSessionInfo = {
  current: { id: string; startedAt: number } | null;
  /** Everything written after this moment belongs to now. */
  currentFrom: number;
  earlier: Array<{ id: string; startedAt: number; until: number }>;
};

export type ChatSessionSplit<Message> = {
  earlier: Array<{ key: string; startedAt: number; messages: Message[] }>;
  current: Message[];
  /** Where the line above the current messages is dated. */
  currentStartedAt: number | null;
};

export const splitChatBySession = <Message extends { timestamp: number }>(
  messages: Message[],
  info: ChatSessionInfo | undefined,
): ChatSessionSplit<Message> => {
  if (!info) return { earlier: [], current: messages, currentStartedAt: null };

  const current = messages.filter(message => message.timestamp >= info.currentFrom);
  const past = messages.filter(message => message.timestamp < info.currentFrom);

  const groups = new Map<string, { key: string; startedAt: number; messages: Message[] }>();
  for (const message of past) {
    // The first session that had not yet closed when the message was written; between two sessions that is the later one.
    const session = info.earlier.find(candidate => message.timestamp <= candidate.until);
    const key = session?.id ?? 'older';
    const group = groups.get(key) ?? { key, startedAt: session?.startedAt ?? message.timestamp, messages: [] };
    group.messages.push(message);
    groups.set(key, group);
  }

  return {
    earlier: [...groups.values()].sort((a, b) => a.startedAt - b.startedAt),
    current,
    currentStartedAt: current.length > 0 ? Math.min(info.current?.startedAt ?? Infinity, current[0].timestamp) : null,
  };
};
