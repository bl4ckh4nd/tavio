import React, { useEffect, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { CircleDot, Hand, LayoutGrid, Moon, Settings, Signal, SignalLow, SignalMedium, SquareUser, Sun } from 'lucide-react';
import { useLocalParticipant } from '@livekit/components-react';
import { ConnectionQuality } from 'livekit-client';
import { BrandMark } from '../../components/BrandMark';
import { IconButton, Tag } from '../../components/ui';
import { AssistantStatus } from './assistant/AssistantOverlay';
import { RoomTimer } from './RoomTimer';

// Connection quality indicator (must be inside LiveKitRoom). Bars report it, and a weak link gets the word as well.
const ConnectionQualityBadge: React.FC = () => {
  const { localParticipant } = useLocalParticipant();
  const quality = localParticipant?.connectionQuality ?? ConnectionQuality.Unknown;
  if (quality === ConnectionQuality.Unknown) return null;
  if (quality === ConnectionQuality.Excellent || quality === ConnectionQuality.Good) {
    const label = quality === ConnectionQuality.Excellent ? t`Connection excellent` : t`Connection good`;
    const Icon = quality === ConnectionQuality.Excellent ? Signal : SignalMedium;
    return (
      <span className="mtop__sig hidden sm:inline-flex" role="img" aria-label={label} title={label}>
        <Icon className="icon" aria-hidden="true" />
      </span>
    );
  }
  const label = t`Connection poor`;
  return (
    <span role="img" aria-label={label} title={label}>
      <Tag variant="board"><SignalLow className="icon" aria-hidden="true" /><span className="hidden sm:inline">{label}</span></Tag>
    </span>
  );
};

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// The clock ticks here, so only the top bar renders every second. It counts from the meeting's
// start, so a remount of the room view does not reset it.
const MeetingClock: React.FC<{ startedAt: number }> = ({ startedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  return <span className="fig mtop__time">{formatTime(Math.max(0, Math.floor((now - startedAt) / 1000)))}</span>;
};

interface MeetingTopBarProps {
  roomName: string;
  startedAt: number;
  partnerLogoUrl?: string;
  isRecording: boolean;
  isBreakoutActive: boolean;
  myHandRaised: boolean;
  layout: 'grid' | 'speaker';
  onLayoutChange: (layout: 'grid' | 'speaker') => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenSettings: () => void;
}

export const MeetingTopBar: React.FC<MeetingTopBarProps> = ({
  roomName,
  startedAt,
  partnerLogoUrl,
  isRecording,
  isBreakoutActive,
  myHandRaised,
  layout,
  onLayoutChange,
  darkMode,
  onToggleDarkMode,
  onOpenSettings,
}) => (
  <div className="mtop">
    <div className="mtop__l">
      {partnerLogoUrl
        ? <img src={partnerLogoUrl} alt={t`${roomName} logo`} className="h-5 w-auto max-w-16 shrink-0 rounded-tag object-contain" />
        : <span className="hidden sm:inline-flex"><BrandMark logoClassName="mtop__logo" className="text-board-type" /></span>}
      <span className="mtop__name">{roomName}</span>
      <MeetingClock startedAt={startedAt} />
      <ConnectionQualityBadge />
      {isRecording && (
        <Tag variant="board" className="min-w-0 shrink">
          <CircleDot className="icon shrink-0" aria-hidden="true" />
          <span className="truncate"><Trans>Recording</Trans>{isBreakoutActive && <> <Trans>(main room only)</Trans></>}</span>
        </Tag>
      )}
      <AssistantStatus />
      <RoomTimer />
      {myHandRaised && (
        <Tag variant="board" className="hidden shrink-0 sm:inline-flex">
          <Hand className="icon" aria-hidden="true" />
          <span><Trans>Hand Raised</Trans></span>
        </Tag>
      )}
    </div>
    <div className="mtop__r">
      <div className="groove groove--board hidden sm:inline-flex" role="group" aria-label={t`Layout`}>
        <button type="button" className={`groove__opt ${layout === 'grid' ? 'is-on' : ''}`} aria-pressed={layout === 'grid'} aria-label={t`Grid view`} onClick={() => onLayoutChange('grid')}>
          <LayoutGrid className="icon" aria-hidden="true" />
          <span><Trans>Grid</Trans></span>
        </button>
        <button type="button" className={`groove__opt ${layout === 'speaker' ? 'is-on' : ''}`} aria-pressed={layout === 'speaker'} aria-label={t`Speaker view`} onClick={() => onLayoutChange('speaker')}>
          <SquareUser className="icon" aria-hidden="true" />
          <span>{t({ message: 'Speaker', context: 'meeting layout' })}</span>
        </button>
      </div>
      <IconButton onBoard label={darkMode ? t`Switch to light mode` : t`Switch to dark mode`} onClick={onToggleDarkMode} className="hidden sm:inline-flex">
        {darkMode ? <Sun className="icon" aria-hidden="true" /> : <Moon className="icon" aria-hidden="true" />}
      </IconButton>
      <IconButton onBoard label={t`Settings`} onClick={onOpenSettings}>
        <Settings className="icon" aria-hidden="true" />
      </IconButton>
    </div>
  </div>
);
