import React, { useEffect } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { usePeople } from './assistant/assistantParticipant';
import type { MeetingEndReason, MeetingSummary, WhiteboardElement } from '../../types';

export interface MeetingSummaryInput {
  roomName?: string;
  roomSlug?: string;
  startedAt: number;
  endedAt: number;
  participantNames?: Iterable<string>;
  chatMessageCount?: number;
  hadNotes?: boolean;
  hadRecording?: boolean;
  reason?: MeetingEndReason;
  sessionId?: string;
  sessionStartedAt?: number;
  hadBoard?: boolean;
  canOpenHistory?: boolean;
  /** The board as it stands, for the tasks on it. */
  board?: WhiteboardElement[];
}

const labelOf = (participant: { name?: string; identity?: string } | undefined | null) =>
  participant?.name?.trim() || participant?.identity?.trim() || '';

/** The task cards on a board, open ones first. */
const tasksOn = (board: WhiteboardElement[]) =>
  board
    .flatMap(el => (el.type === 'shape' && el.shapeType === 'task' && el.text?.trim()
      ? [{ text: el.text.trim(), ...(el.owner ? { owner: el.owner } : {}), ...(el.due ? { due: el.due } : {}), done: !!el.done }]
      : []))
    .sort((a, b) => Number(a.done) - Number(b.done));

/**
 * Builds the snapshot the endscreen renders. Everything here is data the
 * participant already saw in the meeting, so the endscreen needs no server
 * query and stays correct for guests who lose room access on leaving.
 */
export const buildMeetingSummary = (input: MeetingSummaryInput): MeetingSummary => {
  const names = Array.from(input.participantNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    roomName: input.roomName?.trim() || input.roomSlug || '',
    roomSlug: input.roomSlug,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: Math.max(0, input.endedAt - input.startedAt),
    participantNames: Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)),
    chatMessageCount: input.chatMessageCount ?? 0,
    hadNotes: input.hadNotes ?? false,
    hadRecording: input.hadRecording ?? false,
    reason: input.reason ?? 'left',
    ...(input.sessionId ? { sessionId: input.sessionId, sessionStartedAt: input.sessionStartedAt } : {}),
    ...(input.hadBoard ? { hadBoard: true } : {}),
    ...(input.canOpenHistory ? { canOpenHistory: true } : {}),
    tasks: tasksOn(input.board ?? []),
  };
};

/** Clock format, so the duration needs no translation. */
export const formatMeetingDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

/**
 * Accumulates everyone seen during the session. Must live inside <LiveKitRoom>,
 * since the participant hooks read the room context.
 */
export const MeetingParticipantTracker: React.FC<{
  seenRef: React.MutableRefObject<Set<string>>;
}> = ({ seenRef }) => {
  const remoteParticipants = usePeople();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    const seen = seenRef.current;
    const localLabel = labelOf(localParticipant);
    if (localLabel) seen.add(localLabel);
    for (const participant of remoteParticipants) {
      const label = labelOf(participant);
      if (label) seen.add(label);
    }
  }, [localParticipant, remoteParticipants, seenRef]);

  return null;
};
