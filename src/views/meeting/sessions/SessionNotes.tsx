import React, { useContext } from 'react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { MeetingDoc } from '../../../components/MeetingDoc';
import { withoutError } from '../../../hooks/useQueryResult';
import { MeetingRoomContext } from '../MeetingRoomContext';
import { useMeetingQuery } from '../useMeetingQuery';

/** The meeting's notes, told which session is running so it can leave its date line. */
export const SessionNotes: React.FC<React.ComponentProps<typeof MeetingDoc>> = (props) => {
  const room = useContext(MeetingRoomContext);
  const sessions = withoutError(useMeetingQuery(
    api.roomSessions.current,
    room ? { roomId: room.roomId as Id<'rooms'>, accessToken: room.accessToken } : 'skip',
  ));
  return <MeetingDoc {...props} sessionStartedAt={sessions?.current?.startedAt ?? null} />;
};
