import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Button, Modal, Notice } from '../../components/ui';

interface LeaveMeetingDialogProps {
  isOpen: boolean;
  ending: boolean;
  error: string | null;
  onClose: () => void;
  onLeave: () => void;
  onEndForAll: () => void;
}

// Hosts choose between leaving alone and ending the meeting for everyone.
export const LeaveMeetingDialog: React.FC<LeaveMeetingDialogProps> = ({ isOpen, ending, error, onClose, onLeave, onEndForAll }) => (
  <Modal isOpen={isOpen} onClose={onClose} ariaLabel={t`Leave meeting`}>
    <div className="dialog">
      <h2 className="dialog__title">
        <Trans>Leave meeting</Trans>
      </h2>
      <p>
        <Trans>You can leave on your own, or end the meeting and disconnect everyone.</Trans>
      </p>
      {error && <Notice variant="error">{error}</Notice>}
      <div className="dialog__actions flex-wrap">
        <Button variant="ghost" onClick={onClose} disabled={ending}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant="secondary" onClick={onLeave} disabled={ending}>
          <Trans>Leave</Trans>
        </Button>
        <Button variant="danger" onClick={onEndForAll} disabled={ending}>
          {ending ? <Trans>Ending...</Trans> : <Trans>End for everyone</Trans>}
        </Button>
      </div>
    </div>
  </Modal>
);
