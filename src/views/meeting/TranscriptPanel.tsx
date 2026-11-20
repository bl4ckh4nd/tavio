import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Notice } from '../../components/ui';

export type TranscriptSegment = {
  id?: string | number;
  start?: number | string;
  startMs?: number | string;
  startTime?: number | string;
  end?: number | string;
  endMs?: number | string;
  endTime?: number | string;
  text?: string;
  transcript?: string;
  content?: string;
  speaker?: number | string;
  speakerName?: string;
};

export type TranscriptData = {
  status?: string;
  provider?: string;
  text?: string;
  error?: string;
  segments?: TranscriptSegment[];
  utterances?: TranscriptSegment[];
};

type TranscriptPanelProps = {
  transcript?: TranscriptData | null;
  loading?: boolean;
  failed?: boolean;
  darkMode?: boolean;
  onSeek?: (seconds: number) => void;
  activeTime?: number;
};

const parseTime = (value: unknown, field = ''): number | null => {
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part))) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return field.toLowerCase().includes('ms') ? number / 1000 : number;
};

export const transcriptSegmentStart = (segment: TranscriptSegment): number => (
  parseTime(segment.startMs, 'startMs')
  ?? parseTime(segment.startTime, 'startTime')
  ?? parseTime(segment.start, 'start')
  ?? 0
);

export const transcriptSegmentEnd = (segment: TranscriptSegment): number | null => (
  parseTime(segment.endMs, 'endMs')
  ?? parseTime(segment.endTime, 'endTime')
  ?? parseTime(segment.end, 'end')
);

export const transcriptSegmentText = (segment: TranscriptSegment): string => (
  segment.text ?? segment.transcript ?? segment.content ?? ''
);

export const formatTranscriptTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'processing': return <Trans>Transcription in progress</Trans>;
    case 'completed': return <Trans>Transcript ready</Trans>;
    case 'failed': return <Trans>Transcription failed</Trans>;
    default: return <Trans>Waiting for transcript</Trans>;
  }
};

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  transcript,
  loading = false,
  failed = false,
  onSeek,
  activeTime,
}) => {
  const status = String(transcript?.status ?? (loading ? 'processing' : 'pending')).toLowerCase();
  const segments = transcript?.segments ?? transcript?.utterances ?? [];
  const text = transcript?.text?.trim();
  const isFailed = status === 'failed';
  const isProcessing = status === 'processing' || status === 'starting' || status === 'pending';
  const hasContent = Boolean(text) || segments.length > 0;

  return (
    <section className="panel h-full flex-1" aria-label={t`Transcript`}>
      <div className="panel__body">
        {failed ? (
          <Notice variant="error" className="ts-status items-start">
            <Trans>The transcript could not be loaded. Leave the meeting and join again to retry.</Trans>
          </Notice>
        ) : isFailed ? (
          <Notice variant="error" className="ts-status items-start">
            {transcript?.error || <Trans>We could not create a transcript for this recording.</Trans>}
          </Notice>
        ) : hasContent ? (
          <p className="notice ts-status">
            {isProcessing ? <span className="spin" aria-hidden="true" /> : <CheckCircle2 className="icon" aria-hidden="true" />}
            <span>{statusLabel(status)}</span>
            {transcript?.provider && <span className="ts-status__end">{transcript.provider}</span>}
          </p>
        ) : null}

        {isProcessing && !hasContent && (
          <div className="mquiet">
            <p className="empty__title">{statusLabel(status)}</p>
            <p className="muted"><Trans>The transcript will appear here when processing finishes.</Trans></p>
          </div>
        )}

        {segments.length > 0 ? (
          <div className="chat">
            {segments.map((segment, index) => {
              const start = transcriptSegmentStart(segment);
              const content = transcriptSegmentText(segment);
              if (!content) return null;
              const end = transcriptSegmentEnd(segment);
              const isActive = activeTime !== undefined && end !== null && start <= activeTime && activeTime < end;
              const speakerLabel = segment.speakerName
                ?? (segment.speaker === undefined ? undefined : t`Speaker ${Number(segment.speaker) + 1}`);
              return (
                <button
                  key={segment.id ?? `${start}-${index}`}
                  type="button"
                  onClick={() => onSeek?.(start)}
                  disabled={!onSeek}
                  className={`ts-row ${isActive ? 'is-on' : ''}`}
                  aria-label={onSeek ? t`Seek to ${formatTranscriptTime(start)}` : undefined}
                >
                  <span className="ts-row__time fig">{formatTranscriptTime(start)}</span>
                  <span className="min-w-0">
                    {speakerLabel ? <span className="chat__who">{speakerLabel}</span> : null}
                    <span className="chat__msg">{content}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : text ? (
          <div className="chat">
            <p className="chat__msg whitespace-pre-wrap">{text}</p>
          </div>
        ) : !isFailed && !isProcessing ? (
          <div className="mquiet">
            <p className="muted"><Trans>No transcript text is available.</Trans></p>
          </div>
        ) : null}
      </div>
    </section>
  );
};
