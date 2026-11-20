import React, { useState } from 'react';
import DOMPurify from 'dompurify';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation } from 'convex/react';
import { Trash2 } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { useQueryResult } from '../../../hooks/useQueryResult';
import { Button, MeetingRecord, Modal, Notice, Skeleton, Tag } from '../../../components/ui';
import { useToast } from '../../../components/ToastProvider';
import { BoardThumb } from '../../../components/sessions/BoardThumb';
import { formatClock, formatClockRange, formatDurationBetween, formatLongDate, formatShortDate, localizeSessionMarks } from '../../../components/sessions/format';
import type { WhiteboardElement } from '../../../types';
import { elementWords } from '../../../components/whiteboard/operations';
import { LoadFailure } from '../components/RecordingsSection';
import { RoomCrumb } from './RoomPage';

type SessionPageProps = {
  sessionId: string;
  roomName?: string;
  onBack: () => void;
  onOpenRecordings: () => void;
};

const CHAT_PREVIEW = 6;

const Part: React.FC<{ title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <section className="sespart">
    <div className="sespart__head">
      <h2>{title}</h2>
      {action ? <div className="sespart__acts">{action}</div> : null}
    </div>
    {children}
  </section>
);

export const SessionPage: React.FC<SessionPageProps> = ({ sessionId, roomName, onBack, onOpenRecordings }) => {
  const toast = useToast();
  const result = useQueryResult(api.roomSessions.get, { sessionId: sessionId as Id<'roomSessions'> });
  const removeSession = useMutation(api.roomSessions.remove);
  const restoreBoard = useMutation(api.boards.restore);
  const [allMessages, setAllMessages] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const crumb = <RoomCrumb onClick={onBack}>{roomName ?? <Trans>Room</Trans>}</RoomCrumb>;

  if (result instanceof Error) return <div>{crumb}<div className="mt-4"><LoadFailure><Trans>The history could not be loaded</Trans></LoadFailure></div></div>;
  if (result === undefined) {
    return (
      <div role="status" aria-label={t`Loading session`}>
        {crumb}
        <div className="sesgrid mt-4">
          <Skeleton className="h-64" />
          <div className="grid gap-4"><Skeleton className="h-48" /><Skeleton className="h-24" /></div>
        </div>
      </div>
    );
  }
  if (result === null) {
    return (
      <div>
        {crumb}
        <div className="empty sheet mt-4">
          <p className="empty__title"><Trans>This session is no longer in the history.</Trans></p>
          <Button variant="secondary" onClick={onBack}><Trans>Back to the room</Trans></Button>
        </div>
      </div>
    );
  }

  const session = result;
  const endedAt = session.endedAt ?? session.lastActiveAt;
  const shortDate = formatShortDate(session.startedAt);
  const kept = <Trans>State kept</Trans>;
  const messages = allMessages ? session.messages : session.messages.slice(0, CHAT_PREVIEW);
  const hasContent = session.boards.length > 0 || !!session.notesHtml || session.messageTotal > 0 || session.recordings.length > 0;
  const recordingFailed = session.recordings.some(recording => recording.status === 'failed');

  const handleDelete = async () => {
    setBusy(true);
    try {
      await removeSession({ sessionId: session.id });
      onBack();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t`Something went wrong. Please try again.`);
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const handleRestore = async (archiveId: Id<'whiteboardArchive'>) => {
    setBusy(true);
    try {
      await restoreBoard({ roomId: session.roomId, archiveId });
      toast.success(t`The board is back on the room's whiteboard`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t`Something went wrong. Please try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {crumb}
      <div className="sesgrid mt-4">
        <div>
          <MeetingRecord
            title={<Trans>Session from {formatLongDate(session.startedAt)}</Trans>}
            when={session.status === 'open'
              ? <><Trans>Running now</Trans> · {formatClock(session.startedAt)}</>
              : <>{formatClockRange(session.startedAt, endedAt)}</>}
            names={session.participantNames.join(', ') || undefined}
            rows={[
              { label: <Trans>Duration</Trans>, value: formatDurationBetween(session.startedAt, endedAt) },
              { label: <Trans>Participants</Trans>, value: session.participantNames.length },
              { label: <Trans>Chat messages</Trans>, value: session.messageTotal },
              ...(session.boards.length > 0 ? [{ label: <Trans>Whiteboard</Trans>, value: kept }] : []),
              ...(session.notesHtml ? [{ label: <Trans>Notes</Trans>, value: kept }] : []),
            ]}
          />
          {session.canDelete && session.status === 'closed' && (
            <div className="mt-4">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="icon" aria-hidden="true" /><Trans>Delete session</Trans>
              </Button>
            </div>
          )}
        </div>

        <div>
          {!hasContent && (
            <div className="empty sheet">
              <p className="empty__title"><Trans>Session without content</Trans></p>
              <p className="muted text-sm"><Trans>Nobody drew, wrote or noted anything in this meeting.</Trans></p>
            </div>
          )}

          {session.boards.map((board, index) => (
            <Part
              key={board.id}
              title={<>{board.name || <Trans>Whiteboard</Trans>}{session.boards.length > 1 ? <span className="fig muted"> {index + 1}/{session.boards.length}</span> : null}</>}
              action={<Button variant="secondary" size="sm" disabled={busy} onClick={() => void handleRestore(board.id)}><Trans>Put back on the board</Trans></Button>}
            >
              <BoardThumb large elements={board.elements as WhiteboardElement[]} label={t`Whiteboard from ${shortDate}`} />
              {board.comments.length > 0 && (
                <div className="sheet seschat sescomments" role="list" aria-label={t`Comments on the board`}>
                  {board.comments.map(thread => {
                    const on = elementWords((board.elements as WhiteboardElement[]).find(el => el.id === thread.elementId));
                    return (
                      <div key={thread.elementId} role="listitem" className="sescomments__thread">
                        <p className="sescomments__on">
                          <span>{on ? <Trans>On “{on}”</Trans> : <Trans>On an element</Trans>}</span>
                          {thread.resolved ? <Tag><Trans>Done</Trans></Tag> : null}
                        </p>
                        {thread.replies.map((reply, index) => (
                          <div key={index} className="seschat__msg">
                            <span className="seschat__who">{reply.name}<span className="fig">{formatClock(reply.at)}</span></span>
                            <p>{reply.text}</p>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </Part>
          ))}

          {session.notesHtml && (
            <Part title={<Trans>Notes</Trans>}>
              <div className="sheet doc" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(localizeSessionMarks(session.notesHtml)) }} />
            </Part>
          )}

          {session.messageTotal > 0 && (
            <Part title={<Trans>Chat</Trans>}>
              <div className="sheet seschat">
                {messages.map(message => (
                  <div key={message.id} className="seschat__msg">
                    <span className="seschat__who">{message.userName}<span className="fig">{formatClock(message.timestamp)}</span></span>
                    {message.text ? <p>{message.text}</p> : null}
                    {message.attachmentKind ? <p className="muted">{message.attachmentKind === 'gif' ? <Trans>GIF</Trans> : <Trans>Image</Trans>}</p> : null}
                  </div>
                ))}
                {!allMessages && session.messages.length > CHAT_PREVIEW && (
                  <div>
                    <Button variant="secondary" size="sm" onClick={() => setAllMessages(true)}>
                      <Trans>Show all {session.messageTotal} messages</Trans>
                    </Button>
                  </div>
                )}
              </div>
            </Part>
          )}

          {session.recordings.length > 0 && (
            <Part
              title={<Trans context="a finished recording">Recording</Trans>}
              action={<Button variant="secondary" size="sm" onClick={onOpenRecordings}><Trans>Open recordings</Trans></Button>}
            >
              {recordingFailed
                ? <Notice variant="error"><Trans>Recording failed</Trans></Notice>
                : <p className="sespart__quiet"><Trans>A recording was made.</Trans></p>}
            </Part>
          )}
        </div>
      </div>

      <Modal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} ariaLabel={t`Delete session`} className="dialog">
        <h3 className="dialog__title"><Trans>Delete the session from {shortDate}?</Trans></h3>
        <p className="text-sm text-ink-2"><Trans>The board, chat and notes of this session are deleted for good. The recording stays under Recordings.</Trans></p>
        <div className="dialog__actions">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}><Trans>Cancel</Trans></Button>
          <Button variant="danger" disabled={busy} onClick={() => void handleDelete()}><Trans>Delete</Trans></Button>
        </div>
      </Modal>
    </div>
  );
};
