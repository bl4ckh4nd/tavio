import React from 'react';
import { CircleAlert } from 'lucide-react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Button, Notice, Skeleton, Tag } from '../../../components/ui';
import { formatTranscriptTime } from '../../meeting/TranscriptPanel';
import { AdminHeader } from './AdminHeader';

export type RecordingListItem = {
  id: string;
  roomId?: string;
  roomName?: string;
  status?: string;
  transcriptStatus?: string;
  transcript?: { status?: string } | null;
  startedAt?: number;
  stoppedAt?: number;
  durationMs?: number;
  videoUrl?: string;
  playbackUrl?: string;
  mediaUrl?: string;
  url?: string;
  downloadUrl?: string;
  storagePath?: string;
  [key: string]: unknown;
};

type RecordingsSectionProps = {
  recordings?: RecordingListItem[];
  failed?: boolean;
  roomNames: Record<string, string>;
  onOpenRecording: (recording: RecordingListItem) => void;
};

const COLUMNS = { '--cols': 'minmax(0, 1.6fr) 170px 80px minmax(0, 1.2fr) 150px 96px' } as React.CSSProperties;
const SKELETON_COLUMNS = { '--cols': 'minmax(0, 1.6fr) minmax(0, 1fr) 72px 64px' } as React.CSSProperties;
const TAB_OFFSETS = [16, 88, 160];

export const getRecordingVideoUrl = (recording: RecordingListItem | null | undefined): string | undefined => {
  if (!recording) return undefined;
  const candidates = [recording.videoUrl, recording.playbackUrl, recording.mediaUrl, recording.url, recording.downloadUrl];
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
};

export const formatRecordingDate = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
};

export const formatRecordingDuration = (durationMs?: number): string => {
  if (!durationMs || durationMs < 0) return '—';
  return formatTranscriptTime(durationMs / 1000);
};

export const sortRecordings = (recordings: RecordingListItem[]) => (
  [...recordings].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
);

// Status is an ink outline with a word. Finished work needs no outline; failed work adds the alert icon.
const RecordingStatus: React.FC<{ status?: string }> = ({ status }) => {
  const normalized = String(status ?? 'processing').toLowerCase();
  if (normalized === 'completed') return <Tag variant="quiet"><Trans>Completed</Trans></Tag>;
  if (normalized === 'failed') return <Tag><CircleAlert className="icon" aria-hidden="true" /><Trans>Failed</Trans></Tag>;
  return <Tag>{normalized === 'recording' ? <Trans>Recording</Trans> : <Trans>Processing</Trans>}</Tag>;
};

const TranscriptStatus: React.FC<{ recording: RecordingListItem }> = ({ recording }) => {
  const status = recording.transcriptStatus || recording.transcript?.status;
  if (status === 'completed') return <Trans>Transcript ready</Trans>;
  if (status === 'failed') return <Trans>Transcript failed</Trans>;
  if (status === 'processing') return <Trans>Transcript processing</Trans>;
  return <Trans>Transcript pending</Trans>;
};

const roomNameOf = (recording: RecordingListItem, roomNames: Record<string, string>) => (
  recording.roomName || (recording.roomId ? roomNames[recording.roomId] : undefined)
);

const OpenRecordingButton: React.FC<{ recording: RecordingListItem; onOpenRecording: (recording: RecordingListItem) => void }> = ({ recording, onOpenRecording }) => (
  <Button variant="secondary" size="sm" onClick={() => onOpenRecording(recording)} aria-label={t`Open recording`}>
    <Trans>Open</Trans>
  </Button>
);

export const EmptyRecordings: React.FC = () => (
  <div className="empty sheet">
    <p className="empty__title"><Trans>No recordings yet</Trans></p>
    <p className="muted"><Trans>Recordings from your workspace will appear here.</Trans></p>
  </div>
);

// A query that failed stays failed until the page subscribes again, so Try Again reloads.
export const LoadFailure: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="empty sheet">
    <Notice variant="error" className="w-full">{children}</Notice>
    <Button variant="secondary" onClick={() => window.location.reload()}><Trans>Try Again</Trans></Button>
  </div>
);

export const RecordingsSkeleton: React.FC<{ rows?: number }> = ({ rows = 2 }) => (
  <div className="tbl" role="status" aria-label={t`Loading recordings`} style={SKELETON_COLUMNS}>
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="tbl__row dash-skel-row dash-skel-fold">
        <div className="grid gap-1.5">
          <Skeleton className={`h-3 ${index % 2 ? 'w-2/3' : 'w-1/2'}`} />
          <Skeleton className="h-2.5 w-2/5" />
        </div>
        <Skeleton className="h-3 w-[70%]" />
        <Skeleton className="h-5" />
        <Skeleton className="h-8 rounded-stock" />
      </div>
    ))}
  </div>
);

// The record of a meeting, as it appears on Overview.
export const RecordingCards: React.FC<RecordingsSectionProps & { recordings: RecordingListItem[] }> = ({ recordings, roomNames, onOpenRecording }) => (
  <div className="ixstack dash-ixstack">
    {recordings.map((recording, index) => (
      <article key={recording.id} className="ixcard stock dash-ixcard">
        <span className="ixcard__tab" style={{ '--ix-left': `${TAB_OFFSETS[index % TAB_OFFSETS.length]}px` } as React.CSSProperties}>
          {formatRecordingDate(recording.startedAt)}
        </span>
        <div className="min-w-0">
          <h3 className="ixcard__title truncate">{roomNameOf(recording, roomNames) || <Trans>Meeting recording</Trans>}</h3>
          <div className="ixcard__meta">
            <span className="fig text-ink-2">{formatRecordingDuration(recording.durationMs)}</span>
            <span><TranscriptStatus recording={recording} /></span>
          </div>
        </div>
        <OpenRecordingButton recording={recording} onOpenRecording={onOpenRecording} />
      </article>
    ))}
  </div>
);

export const RecordingsSection: React.FC<RecordingsSectionProps> = ({ recordings, failed = false, roomNames, onOpenRecording }) => {
  const sorted = recordings ? sortRecordings(recordings) : [];

  return (
    <section>
      <AdminHeader title={<Trans>Recordings</Trans>} description={<Trans>Recordings from your workspace will appear here.</Trans>} />
      {failed ? (
        <LoadFailure><Trans>Recordings could not be loaded</Trans></LoadFailure>
      ) : recordings === undefined ? (
        <RecordingsSkeleton rows={3} />
      ) : sorted.length === 0 ? (
        <EmptyRecordings />
      ) : (
        <div className="tbl dash-rec" role="table" aria-label={t`Recordings`} style={COLUMNS}>
          <div className="tbl__row tbl__row--head" role="row">
            <span role="columnheader"><Trans>Room</Trans></span>
            <span role="columnheader"><Trans>Started</Trans></span>
            <span role="columnheader"><Trans>Duration</Trans></span>
            <span role="columnheader"><Trans>Transcript</Trans></span>
            <span role="columnheader"><Trans>Status</Trans></span>
            <span role="columnheader" className="text-right"><Trans>Action</Trans></span>
          </div>
          {sorted.map(recording => (
            <div key={recording.id} className="tbl__row" role="row">
              <p role="cell" className="tbl__name dash-rec__name" title={roomNameOf(recording, roomNames) || undefined}>{roomNameOf(recording, roomNames) || <Trans>Meeting recording</Trans>}</p>
              <span role="cell" className="tbl__cell dash-rec__cell dash-rec__when">
                <span>
                  {formatRecordingDate(recording.startedAt)}
                  <span className="dash-rec__dur-inline"> · <Trans>Duration</Trans> {formatRecordingDuration(recording.durationMs)}</span>
                </span>
              </span>
              <span role="cell" className="tbl__cell dash-rec__dur">{formatRecordingDuration(recording.durationMs)}</span>
              <span role="cell" className="tbl__cell dash-rec__cell dash-rec__transcript"><span><TranscriptStatus recording={recording} /></span></span>
              <div role="cell" className="dash-rec__status"><RecordingStatus status={recording.status} /></div>
              <div role="cell" className="tbl__actions dash-rec__open"><OpenRecordingButton recording={recording} onOpenRecording={onOpenRecording} /></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
