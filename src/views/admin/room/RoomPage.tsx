import React from 'react';
import DOMPurify from 'dompurify';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { ArrowLeft, Copy, FileText, Layers, MessageSquare, Video } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { useQueryResult, withoutError } from '../../../hooks/useQueryResult';
import { Button, Skeleton, Stamp, Tag } from '../../../components/ui';
import { BoardThumb } from '../../../components/sessions/BoardThumb';
import { formatClockRange, formatDurationBetween, formatLongDate, formatShortDate, formatSessionStart, localizeSessionMarks } from '../../../components/sessions/format';
import type { Room, WhiteboardElement } from '../../../types';
import { LoadFailure } from '../components/RecordingsSection';
import { LiveTag, RoomAccessLabel } from '../components/RoomsTable';

type RoomPageProps = {
  room: Room | undefined;
  roomsLoading: boolean;
  onBack: () => void;
  onJoin: (room: Room) => void;
  onCopyLink: (room: Room) => void;
  onOpenSession: (sessionId: string) => void;
};

type SessionRow = {
  id: string;
  status: 'open' | 'closed';
  startedAt: number;
  endedAt: number | null;
  lastActiveAt: number;
  participantNames: string[];
  messageCount: number | null;
  hasBoard: boolean;
  hasNotes: boolean;
  recordingStatus: string | null;
};

export const RoomCrumb: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <div className="crumbrow">
    <button type="button" className="crumb" onClick={onClick}>
      <ArrowLeft className="icon" aria-hidden="true" />{children}
    </button>
  </div>
);

const HistorySkeleton: React.FC = () => (
  <div className="seslist" role="status" aria-label={t`Loading history`}>
    {[0, 1, 2].map(index => (
      <div key={index} className="sescard stock">
        <div className="grid gap-2">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
    ))}
  </div>
);

/** What a session left behind, as plain words with an icon; a failed recording says so. */
const SessionHas: React.FC<{ session: SessionRow }> = ({ session }) => {
  const nothing = !session.hasBoard && !session.hasNotes && !session.messageCount && !session.recordingStatus;
  if (nothing) return <div className="sescard__has"><span><Trans>Nothing kept</Trans></span></div>;
  return (
    <div className="sescard__has">
      {session.hasBoard && <span><Layers className="icon" aria-hidden="true" /><Trans>Whiteboard</Trans></span>}
      {session.hasNotes && <span><FileText className="icon" aria-hidden="true" /><Trans>Notes</Trans></span>}
      {!!session.messageCount && <span><MessageSquare className="icon" aria-hidden="true" /><span className="fig">{session.messageCount}</span></span>}
      {session.recordingStatus === 'failed'
        ? <span className="text-error"><Video className="icon" aria-hidden="true" /><Trans>Recording failed</Trans></span>
        : session.recordingStatus ? <span><Video className="icon" aria-hidden="true" /><Trans context="a finished recording">Recording</Trans></span> : null}
    </div>
  );
};

const SessionCard: React.FC<{ session: SessionRow; onOpen: () => void }> = ({ session, onOpen }) => {
  const names = session.participantNames.join(', ');
  if (session.status === 'open') {
    return (
      <div className="sescard sescard--live stock">
        <div className="grid min-w-0 gap-1">
          <p className="sescard__when"><b><Trans>Running now</Trans></b><span><Trans>since</Trans> {formatSessionStart(session.startedAt)}</span></p>
          <p className="sescard__names">{names}</p>
        </div>
        <LiveTag count={session.participantNames.length} />
        <p className="sescard__note"><Trans>It is filed once the room has been empty for 10 minutes.</Trans></p>
      </div>
    );
  }
  const endedAt = session.endedAt ?? session.lastActiveAt;
  return (
    <button type="button" className="sescard stock" onClick={onOpen} aria-label={t`Open the session from ${formatLongDate(session.startedAt)}`}>
      <div className="grid min-w-0 gap-1">
        <p className="sescard__when">
          <b>{formatLongDate(session.startedAt)}</b>
          <span>{formatClockRange(session.startedAt, endedAt)} · {formatDurationBetween(session.startedAt, endedAt)}</span>
        </p>
        <p className="sescard__names">{names}</p>
      </div>
      <SessionHas session={session} />
    </button>
  );
};

/** The room's working state: what is on the wall and in the notes right now. */
const InRoom: React.FC<{ roomId: string }> = ({ roomId }) => {
  const wall = withoutError(useQueryResult(api.whiteboard.get, { roomId }));
  const notes = withoutError(useQueryResult(api.meetingDoc.get, { roomId }));
  const elements = (wall?.elements ?? []) as WhiteboardElement[];
  const hasNotes = !!notes?.changedAt;
  if (wall === undefined || notes === undefined) return <Skeleton className="h-40" />;
  if (elements.length === 0 && !hasNotes) {
    return <p className="sespart__quiet"><Trans>Nothing in the room yet. The board and the notes of the next meeting stay here.</Trans></p>;
  }
  return (
    <div className="inroom">
      {elements.length > 0 && (
        <div className="inroom__sheet stock">
          <BoardThumb elements={elements} />
          <div className="inroom__cap">
            <b>{wall?.name || <Trans>Whiteboard</Trans>}</b>
            {wall?.changedAt ? <span className="inroom__when"><Trans>changed</Trans> {formatShortDate(wall.changedAt)}</span> : null}
          </div>
        </div>
      )}
      {hasNotes && notes && (
        <div className="inroom__sheet stock">
          <div className="doc" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(localizeSessionMarks(notes.contentHtml)) }} />
          <div className="inroom__cap">
            <b><Trans>Notes</Trans></b>
            {notes.changedAt ? <span className="inroom__when"><Trans>changed</Trans> {formatShortDate(notes.changedAt)}</span> : null}
          </div>
        </div>
      )}
      <div><Stamp size="s"><Trans>Saved in this room</Trans></Stamp></div>
    </div>
  );
};

const History: React.FC<{ roomId: string; onOpenSession: (sessionId: string) => void }> = ({ roomId, onOpenSession }) => {
  const result = useQueryResult(api.roomSessions.listForRoom, { roomId: roomId as Id<'rooms'> });
  if (result instanceof Error) return <LoadFailure><Trans>The history could not be loaded</Trans></LoadFailure>;
  if (result === undefined) return <HistorySkeleton />;
  const sessions = result as SessionRow[];
  if (sessions.length === 0) {
    return (
      <div className="empty sheet">
        <p className="empty__title"><Trans>No session yet</Trans></p>
        <p className="muted text-sm"><Trans>After the first meeting its record is here: who was there, what was on the board and what was noted.</Trans></p>
      </div>
    );
  }
  return (
    <div className="seslist">
      {sessions.map(session => <SessionCard key={session.id} session={session} onOpen={() => onOpenSession(session.id)} />)}
    </div>
  );
};

export const RoomPage: React.FC<RoomPageProps> = ({ room, roomsLoading, onBack, onJoin, onCopyLink, onOpenSession }) => {
  const crumb = <RoomCrumb onClick={onBack}><Trans>Rooms</Trans></RoomCrumb>;
  if (!room) {
    return (
      <div>
        {crumb}
        {roomsLoading ? <Skeleton className="mt-4 h-10 w-1/3" /> : (
          <div className="empty sheet mt-4">
            <p className="empty__title"><Trans>This room does not exist, or you do not have access to it.</Trans></p>
            <Button variant="secondary" onClick={onBack}><Trans>Back to Rooms</Trans></Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div>
      {crumb}
      <div className="roomhead">
        <div className="min-w-0">
          <h1 className="h-page truncate">{room.name}</h1>
          <div className="roomhead__meta">
            <span className="fig muted text-sm">/{room.slug}</span>
            <RoomAccessLabel access={room.access} />
            {room.activeParticipants > 0 ? <LiveTag count={room.activeParticipants} /> : <Tag variant="quiet"><Trans>Offline</Trans></Tag>}
          </div>
        </div>
        <div className="roomhead__acts">
          <Button variant="secondary" onClick={() => onCopyLink(room)}><Copy className="icon" aria-hidden="true" /><Trans>Copy link</Trans></Button>
          <Button onClick={() => onJoin(room)}><Trans>Join</Trans></Button>
        </div>
      </div>
      <div className="roomgrid">
        <section aria-labelledby="room-history">
          <h2 id="room-history" className="roomgrid__h"><Trans>History</Trans></h2>
          <History roomId={room.id} onOpenSession={onOpenSession} />
        </section>
        <section aria-labelledby="room-now">
          <h2 id="room-now" className="roomgrid__h"><Trans>In the room</Trans></h2>
          <InRoom roomId={room.id} />
        </section>
      </div>
    </div>
  );
};
