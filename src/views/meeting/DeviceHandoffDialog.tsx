import { t } from '@lingui/core/macro';
import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Share2, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Trans } from '@lingui/react/macro';
import { Button, IconButton, Modal, Notice } from '../../components/ui';

export interface DeviceHandoffDialogProps {
  show: boolean;
  darkMode: boolean;
  code?: string | null;
  expiresAt?: number | null;
  loading?: boolean;
  error?: string | null;
  onCreate: () => void;
  onCancel: () => void;
  onClose: () => void;
}

export const DeviceHandoffDialog: React.FC<DeviceHandoffDialogProps> = ({
  show,
  code,
  expiresAt,
  loading = false,
  error,
  onCreate,
  onCancel,
  onClose,
}) => {
  const [remaining, setRemaining] = useState(0);
  const link = useMemo(() => code && typeof window !== 'undefined' ? `${window.location.origin}/handoff/${encodeURIComponent(code)}` : '', [code]);

  useEffect(() => {
    if (!show || !expiresAt) {
      setRemaining(0);
      return;
    }
    const update = () => setRemaining(Math.max(0, expiresAt - Date.now()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, show]);

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard?.writeText(link);
  };

  const shareLink = async () => {
    if (!link) return;
    if (navigator.share) {
      await navigator.share({ title: 'Join this meeting on another device', url: link });
      return;
    }
    await copyLink();
  };

  if (!show) return null;
  const expired = !!expiresAt && remaining === 0;
  return (
    <Modal isOpen={show} onClose={onClose} ariaLabel={t`Switch device`} className="max-h-[calc(100dvh-1rem)] overflow-y-auto">
      <div className="dialog">
        <div className="flex items-start justify-between gap-3">
          <h2 className="dialog__title"><Trans>Switch to another device</Trans></h2>
          <IconButton label={t`Close`} onClick={onClose} className="-mr-2 -mt-1.5"><X className="icon" aria-hidden="true" /></IconButton>
        </div>
        <p><Trans>Open this one-time link on your phone or another computer. Your meeting identity and breakout room will transfer.</Trans></p>
        {loading && <p className="muted flex items-center gap-2"><span className="spin" aria-hidden="true" /><Trans>Creating secure link…</Trans></p>}
        {code && !expired && (
          <>
            <div className="flex justify-center"><QRCodeSVG value={link} size={180} includeMargin className="rounded-input" /></div>
            <div className="field">
              <label htmlFor="handoff-link" className="field__label"><Trans>Secure handoff link</Trans></label>
              <input id="handoff-link" readOnly value={link} className="input fig" />
            </div>
            <div className="dialog__actions flex-wrap">
              <Button type="button" variant="secondary" onClick={() => void copyLink()}><Copy className="icon" aria-hidden="true" /><Trans>Copy</Trans></Button>
              <Button type="button" variant="secondary" onClick={() => void shareLink()}><Share2 className="icon" aria-hidden="true" /><Trans>Share</Trans></Button>
            </div>
            <p className="muted text-center text-xs"><Trans>Expires in {Math.ceil(remaining / 1000)} seconds</Trans></p>
            <Button type="button" variant="ghost" onClick={onCancel} className="btn--wide"><Trans>Cancel link</Trans></Button>
          </>
        )}
        {(!code || expired) && !loading && (
          <div className="dialog__actions">
            <Button type="button" onClick={onCreate}><Trans>Create new link</Trans></Button>
          </div>
        )}
        {error && <Notice variant="error">{error}</Notice>}
      </div>
    </Modal>
  );
};
