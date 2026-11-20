import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../convex/_generated/api';
import { withoutError } from '../../../hooks/useQueryResult';
import { useMeetingQuery } from '../useMeetingQuery';

// Chat state that outlives the panel: messages, the unread count for the toolbar badge, and the unsent draft.
export const useChat = ({
  roomId,
  roomAccessToken,
  isOpen,
}: {
  roomId: string | undefined;
  roomAccessToken: string | undefined;
  isOpen: boolean;
}) => {
  const chatResult = useMeetingQuery(api.chat.list, roomId ? { roomId, accessToken: roomAccessToken } : 'skip');
  const messages = withoutError(chatResult);
  const failed = chatResult instanceof Error;
  const loading = roomId ? chatResult === undefined : false;
  const [draft, setDraft] = useState('');
  const [lastReadTs, setLastReadTs] = useState<number>(() => Date.now());
  const [unreadCount, setUnreadCount] = useState(0);

  const markRead = useCallback((timestamp?: number) => {
    const latest = timestamp ?? (messages && messages.length > 0 ? messages[messages.length - 1].timestamp : Date.now());
    setLastReadTs(latest);
    setUnreadCount(0);
  }, [messages]);

  // Messages that arrive while the panel is open count as read; while it is closed they are counted.
  useEffect(() => {
    if (!messages) return;
    if (isOpen) {
      const latest = messages[messages.length - 1]?.timestamp;
      if (latest) setLastReadTs(prev => Math.max(prev, latest));
      setUnreadCount(0);
      return;
    }
    setUnreadCount(messages.filter(m => m.timestamp > lastReadTs).length);
  }, [messages, isOpen, lastReadTs]);

  return { messages, loading, failed, unreadCount, markRead, draft, setDraft };
};

export type ChatState = ReturnType<typeof useChat>;
export type ChatMessage = NonNullable<ChatState['messages']>[number];
