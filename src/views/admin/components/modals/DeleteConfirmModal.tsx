import { t } from '@lingui/core/macro';
import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Room } from '../../../../types';
import { Button, Modal } from '../../../../components/ui';

type DeleteConfirmModalProps = {
  room: Room | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({ room, onCancel, onConfirm }) => {
  return (
    <Modal isOpen={!!room} onClose={onCancel} ariaLabel={t`Delete room?`} className="dialog">
      <h3 className="dialog__title"><Trans>Delete room?</Trans></h3>
      <p>
        <Trans>Are you sure you want to delete</Trans> <span className="font-semibold">{room?.name}</span>?
      </p>
      <div className="dialog__actions">
        <Button variant="secondary" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          <Trans>Delete</Trans>
        </Button>
      </div>
    </Modal>
  );
};
