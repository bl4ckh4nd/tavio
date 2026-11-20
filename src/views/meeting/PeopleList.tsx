import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Hand, Share, Mic, MicOff } from 'lucide-react';
import { useLocalParticipant } from '@livekit/components-react';
import { usePeople } from './assistant/assistantParticipant';
import { Participant } from 'livekit-client';
import { Avatar, Button, Tag } from '../../components/ui';
import { useToast } from '../../components/ToastProvider';

export interface PeopleListProps {
  handRaisedByIdentity: Record<string, boolean>;
  darkMode?: boolean;
}

// Detect UUID-like or system identity strings and replace with a readable fallback
const resolveDisplayName = (p: Participant): string => {
  if (p.name && p.name.trim()) return p.name.trim();
  // Identity strings like "guest-xxxxxxxx-xxxx-..." are not user-readable
  const uuidPattern = /^guest-[0-9a-f-]{36}$/i;
  if (p.identity && !uuidPattern.test(p.identity)) return p.identity;
  return t`Guest`;
};

export const ParticipantCount: React.FC = () => {
  const remoteParticipants = usePeople();
  const { localParticipant } = useLocalParticipant();
  const count = remoteParticipants.length + (localParticipant ? 1 : 0);
  return <span className="fig muted text-sm">{count}</span>;
};

export const PeopleList: React.FC<PeopleListProps> = ({ handRaisedByIdentity }) => {
  const remoteParticipants = usePeople();
  const { localParticipant } = useLocalParticipant();
  const toast = useToast();

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t`Meeting link copied`);
    } catch {
      toast.error(t`Could not copy the meeting link. Copy it from the address bar instead.`);
    }
  };

  const allParticipants = [localParticipant, ...remoteParticipants].filter(Boolean) as Participant[];

  return (
    <div className="flex h-full flex-col">
      <div className="panel__body">
        {allParticipants.map((p) => {
          const displayName = resolveDisplayName(p);
          const isLocal = p.sid === localParticipant?.sid;
          const isMuted = p.isMicrophoneEnabled === false;
          const handRaised = !!p.identity && !!handRaisedByIdentity[p.identity];

          return (
            <div key={p.sid} className="row">
              <Avatar name={displayName} size="sm" />
              <span className="row__main">
                {displayName}
                {isLocal && <span className="muted font-normal"> <Trans>(You)</Trans></span>}
              </span>
              {handRaised && (
                <Tag>
                  <Hand className="icon" aria-hidden="true" />
                  <Trans>Hand Raised</Trans>
                </Tag>
              )}
              <span className="muted inline-flex" role="img" aria-label={isMuted ? t`Muted` : t`Mic on`}>
                {isMuted ? <MicOff className="icon" aria-hidden="true" /> : <Mic className="icon" aria-hidden="true" />}
              </span>
            </div>
          );
        })}
      </div>
      <div className="panel__foot">
        <Button type="button" variant="secondary" onClick={() => void copyInviteLink()} className="btn--wide">
          <Share className="icon" aria-hidden="true" /> <Trans>Invite People</Trans>
        </Button>
      </div>
    </div>
  );
};
