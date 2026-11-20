import React, { useEffect, useRef, useState } from 'react';
import { Captions, Download, X } from 'lucide-react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { useHistoryEntry } from '../../../hooks/useHistoryEntry';
import { TranscriptPanel, type TranscriptData } from '../../meeting/TranscriptPanel';
import { formatRecordingDate, formatRecordingDuration, getRecordingVideoUrl, type RecordingListItem } from './RecordingsSection';

type RecordingViewerModalProps = {
  recording: RecordingListItem | null;
  transcript?: TranscriptData | null;
  transcriptLoading?: boolean;
  roomName?: string;
  onClose: () => void;
};

export const RecordingViewerModal: React.FC<RecordingViewerModalProps> = ({
  recording,
  transcript,
  transcriptLoading,
  roomName,
  onClose,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const videoUrl = getRecordingVideoUrl(recording);

  useEffect(() => {
    if (!recording) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, recording]);

  // Back closes the viewer instead of leaving the dashboard.
  useHistoryEntry(!!recording, onClose);

  if (!recording) return null;

  return <div className="g-board dash-viewer" role="dialog" aria-modal="true" aria-labelledby="recording-viewer-title">
    <header className="dash-viewer__head">
      <div className="dash-viewer__id">
        <h2 id="recording-viewer-title" className="dash-viewer__title">{roomName || <Trans>Meeting recording</Trans>}</h2>
        <span className="fig dash-viewer__meta">{formatRecordingDate(recording.startedAt)}</span>
        <span className="fig dash-viewer__meta">{formatRecordingDuration(recording.durationMs)}</span>
      </div>
      <div className="dash-viewer__tools">
        {videoUrl && <a href={videoUrl} download className="btn btn--card btn--s" aria-label={t`Download recording`}><Download className="icon" aria-hidden="true" /><span className="max-sm:hidden"><Trans>Download</Trans></span></a>}
        <button ref={closeRef} type="button" onClick={onClose} className="icon-btn icon-btn--board" aria-label={t`Close recording`}><X className="icon" aria-hidden="true" /></button>
      </div>
    </header>

    <div className="dash-viewer__body">
      <div className="tile dash-viewer__stage">
        {videoUrl ? <video ref={videoRef} src={videoUrl} controls preload="metadata" onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} className="dash-viewer__video" aria-label={t`Recording video`} /> : <div className="dash-viewer__empty"><Captions className="icon--l" aria-hidden="true" /><p><Trans>The video is not available for this recording yet.</Trans></p></div>}
      </div>
      <aside className="panel stock mpanel" aria-label={t`Transcript`}>
        <div className="panel__head"><h3 className="panel__title"><Trans>Transcript</Trans></h3></div>
        <TranscriptPanel transcript={transcript} loading={transcriptLoading} activeTime={currentTime} onSeek={(seconds) => { if (videoRef.current) { videoRef.current.currentTime = seconds; setCurrentTime(seconds); void videoRef.current.play().catch(() => {}); } }} />
      </aside>
    </div>
  </div>;
};
