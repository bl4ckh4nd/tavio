import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { withoutError } from '../../../hooks/useQueryResult';
import { useMeetingQuery } from '../useMeetingQuery';

/**
 * What the end screen says about the session: whether the room counted this meeting as one,
 * whether the board was drawn on during it, and whether this person may open the history.
 */
export const useSessionSummary = (roomId: string | undefined, accessToken: string | undefined) => {
  const args = roomId ? { roomId: roomId as Id<'rooms'>, accessToken } : 'skip';
  const sessions = withoutError(useMeetingQuery(api.roomSessions.current, args));
  const wall = withoutError(useMeetingQuery(api.whiteboard.get, roomId ? { roomId, accessToken } : 'skip'));
  const session = sessions?.current ?? null;
  return {
    sessionId: session?.id as string | undefined,
    sessionStartedAt: session?.startedAt,
    hadBoard: !!session && !!wall && wall.elements.length > 0 && (wall.changedAt ?? 0) >= session.startedAt,
    canOpenHistory: !!sessions?.canSeeEarlier,
    // Messages before this moment belong to earlier sessions, which a member still has in the chat.
    currentFrom: sessions?.currentFrom ?? 0,
  };
};
