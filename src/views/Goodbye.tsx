import React from 'react';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { BrandMark } from '../components/BrandMark';
import { Button, MeetingRecord, Tag } from '../components/ui';
import type { MeetingSummary } from '../types';
import { formatMeetingDuration } from './meeting/meetingSummary';
import { formatClockRange, formatDueDate, formatShortDate } from '../components/sessions/format';

const MAX_LISTED_PARTICIPANTS = 8;

/** The room's record on the desk, written only from what the summary knows. */
const SummaryRecord: React.FC<{ summary: MeetingSummary; onOpenSession?: () => void }> = ({ summary, onOpenSession }) => {
  const { _ } = useLingui();
  const held = <Trans>State kept</Trans>;
  const listed = summary.participantNames.slice(0, MAX_LISTED_PARTICIPANTS);
  const overflow = summary.participantNames.length - listed.length;
  const names = listed.map((name) => name.replace(/ /g, '\u00A0')).join(', ');

  return (
    <MeetingRecord
      large
      className="w-full max-w-[660px] rotate-[0.6deg] [overflow-wrap:anywhere] min-[961px]:rotate-[0.8deg] max-sm:text-sm max-sm:[&>div>div]:py-2 max-sm:[&>p:first-child]:text-xl max-sm:[&>p:nth-child(2)]:text-sm max-sm:[&_.stamp]:whitespace-normal max-sm:[&_.stamp]:text-lg"
      title={summary.roomName}
      when={summary.sessionStartedAt
        ? <><Trans>Session</Trans> · {formatShortDate(summary.sessionStartedAt)}, {formatClockRange(summary.sessionStartedAt, summary.endedAt)}</>
        : undefined}
      names={listed.length > 0 ? `${names}${overflow > 0 ? ` +${overflow}` : ''}` : undefined}
      rows={[
        { label: <Trans>Duration</Trans>, value: formatMeetingDuration(summary.durationMs) },
        ...(listed.length > 0 ? [{ label: <Trans>Participants</Trans>, value: summary.participantNames.length }] : []),
        { label: <Trans>Chat messages</Trans>, value: summary.chatMessageCount },
        // A session's record holds the board and the notes as they stood; without a session there is no record.
        ...(summary.sessionId && summary.hadBoard ? [{ label: <Trans>Whiteboard</Trans>, value: held }] : []),
        ...(summary.sessionId && summary.hadNotes ? [{ label: <Trans>Notes</Trans>, value: held }] : []),
      ]}
      stamp={summary.hadNotes || summary.hadRecording || summary.chatMessageCount > 0 ? <Trans>Saved in this room</Trans> : undefined}
    >
      {(summary.hadNotes || summary.hadRecording) && (
        <div className="mt-4">
          {summary.hadNotes && <p className="record__rec"><Trans>Shared notes were saved to this room</Trans></p>}
          {summary.hadRecording && <p className="record__rec"><Trans>A recording was made and is processing</Trans></p>}
        </div>
      )}
      {summary.tasks && summary.tasks.length > 0 && (
        <div className="mt-4">
          <p className="record__rec"><Trans>Tasks from the board</Trans></p>
          <ul className="endtasks" aria-label={_(/* i18n */ 'Tasks')}>
            {summary.tasks.map((task, i) => (
              <li key={i} className={task.done ? 'is-done' : ''}>
                <span className="endtasks__text">{task.text}</span>
                {(task.owner || task.due) && (
                  <span className="endtasks__who">{[task.owner, task.due && formatDueDate(task.due)].filter(Boolean).join(' · ')}</span>
                )}
                {task.done && <Tag><Trans>Done</Trans></Tag>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {onOpenSession && (
        <p className="endmore">
          <button type="button" className="link cursor-pointer" onClick={onOpenSession}><Trans>Open this session in the history</Trans></button>
        </p>
      )}
    </MeetingRecord>
  );
};

export const Goodbye: React.FC<{
  onNavigateHome: () => void;
  summary?: MeetingSummary | null;
  onRejoin?: () => void;
  /** Opens the session's page in the room's history; only offered to people who belong to the room. */
  onOpenSession?: () => void;
}> = ({ onNavigateHome, summary, onRejoin, onOpenSession }) => {
  const { _ } = useLingui();

  return (
    <main className="th g-desk">
      <div className="th__top">
        <button
          type="button"
          onClick={onNavigateHome}
          aria-label={_(/* i18n */ 'Tavio home')}
          className="flex min-h-11 cursor-pointer items-center rounded-input"
        >
          <BrandMark logoClassName="bar__logo" />
        </button>
      </div>

      <div className="endgrid max-[960px]:content-start">
        {/* Below the fold the wrapper dissolves, so the record can sit between the heading and the actions. */}
        <div className="contents min-[961px]:block">
          <div className="order-1">
            <h1 className="text-3xl font-semibold leading-[1.08] tracking-[-0.025em] min-[961px]:text-threshold min-[961px]:leading-[1.04] min-[961px]:tracking-[-0.03em]">
              <Trans>The call is over.</Trans>
              <br />
              <Trans>The room stays.</Trans>
            </h1>
            {summary?.reason === 'host_ended' && (
              <p className="muted mt-3 text-md">
                <Trans>The host ended the meeting for everyone. Thanks for being there!</Trans>
              </p>
            )}
          </div>

          <div className="order-3 grid gap-2 min-[961px]:mt-10 min-[961px]:flex min-[961px]:flex-wrap min-[961px]:gap-3">
            <Button onClick={onNavigateHome} size="lg">
              <Trans>Back to Rooms</Trans>
            </Button>
            {onRejoin && (
              <Button variant="secondary" onClick={onRejoin} size="lg">
                <Trans>Rejoin meeting</Trans>
              </Button>
            )}
          </div>
        </div>

        {summary && (
          <div className="order-2 flex min-w-0 justify-end">
            <SummaryRecord summary={summary} onOpenSession={summary.sessionId && summary.canOpenHistory ? onOpenSession : undefined} />
          </div>
        )}
      </div>
    </main>
  );
};
