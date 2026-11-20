import { t } from '@lingui/core/macro';
import React from 'react';
import DOMPurify from 'dompurify';
import { Trans } from '@lingui/react/macro';
import { X } from 'lucide-react';
import { Room } from '../../../../types';
import { IconButton, Modal } from '../../../../components/ui';
import { useHistoryEntry } from '../../../../hooks/useHistoryEntry';
import { NotesDoc } from '../../types';

type NotesModalProps = {
  room: Room | null;
  doc: NotesDoc;
  hasNotes: boolean;
  onClose: () => void;
};

export const NotesModal: React.FC<NotesModalProps> = ({ room, doc, hasNotes, onClose }) => {
  useHistoryEntry(!!room, onClose);
  return (
    <Modal isOpen={!!room} onClose={onClose} ariaLabel={t`Meeting Notes`} className="panel dash-notes">
      <div className="panel__head">
        <h3 className="panel__title">
          <Trans>Meeting Notes</Trans> - {room?.name}
        </h3>
        <IconButton label={t`Close`} onClick={onClose}><X className="icon" aria-hidden="true" /></IconButton>
      </div>
      <div className="panel__body doc">
        {doc === undefined ? (
          <p className="muted"><Trans>Loading notes...</Trans></p>
        ) : hasNotes ? (
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(doc?.contentHtml || '') }} />
        ) : (
          <p className="muted"><Trans>No notes recorded for this room.</Trans></p>
        )}
      </div>
    </Modal>
  );
};
