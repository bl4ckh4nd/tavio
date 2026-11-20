import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';

export const ScreenShareToast: React.FC = () => {
  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false });
  const isActive = screenTracks.length > 0;
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!isActive) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [isActive]);

  if (!visible) return null;
  const sharerName = screenTracks[0]?.participant?.name || screenTracks[0]?.participant?.identity || t`Someone`;
  return (
    <div role="status" className="toast mtoast entry-fade">
      <Trans>{sharerName} started screen sharing</Trans>
    </div>
  );
};
