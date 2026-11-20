import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Link } from '@tanstack/react-router';
import { api } from '../../../../../convex/_generated/api';
import { Button, Input, Modal, Notice, Skeleton } from '../../../../components/ui';
import { useToast } from '../../../../components/ToastProvider';
import { formatRecordingDate } from '../RecordingsSection';

const COLUMNS = { '--cols': 'minmax(0, 1fr) 150px 150px 104px' } as React.CSSProperties;

type ApiKey = { id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null };

export const ApiKeysPanel: React.FC = () => {
  const keys = useQuery(api.apiKeys.list, {}) as ApiKey[] | null | undefined;
  const createKey = useAction(api.apiKeys.create);
  const revokeKey = useMutation(api.apiKeys.revoke);
  const toast = useToast();

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { key } = await createKey({ name: name.trim() });
      setNewKey(key);
      setCopied(false);
      setName('');
      setError(null);
    } catch (err: any) {
      setError((typeof err?.data === 'string' && err.data) || t`Could not create the key.`);
    } finally {
      setSaving(false);
    }
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      toast.error(t`Could not copy. Select the text instead.`);
    }
  };

  const handleRevoke = async () => {
    if (!confirmRevoke) return;
    try {
      await revokeKey({ id: confirmRevoke.id as any });
      toast.success(t`Revoked "${confirmRevoke.name}"`);
      setConfirmRevoke(null);
      setNewKey(null);
    } catch {
      toast.error(t`Could not revoke the key.`);
    }
  };

  if (keys === null) {
    return <p className="muted"><Trans>Only workspace owners and admins can manage API keys.</Trans></p>;
  }

  return (
    <div className="dash-columns dash-columns--8-4">
      <section className="dash-sec">
        <div className="dash-sec__head block">
          <h2 className="h-sec"><Trans>API keys</Trans></h2>
          <p className="muted mt-0.5">
            <Trans>A key lets your own server create, list and delete this workspace's rooms and read its recordings.</Trans>{' '}
            <Link to="/docs" hash="api" className="link"><Trans>Read the API docs</Trans></Link>
          </p>
        </div>

        {keys === undefined ? (
          <div className="tbl" role="status" aria-label={t`API keys`} style={COLUMNS}>
            {[1, 2].map(item => (
              <div key={item} className="tbl__row dash-skel-row dash-skel-fold">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3" />
                <Skeleton className="h-3" />
                <Skeleton className="h-8" />
              </div>
            ))}
          </div>
        ) : keys.length === 0 ? (
          <p className="muted"><Trans>No API keys yet.</Trans></p>
        ) : (
          <div className="tbl dash-keys" role="table" aria-label={t`API keys`} style={COLUMNS}>
            <div className="tbl__row tbl__row--head" role="row">
              <span role="columnheader"><Trans>Name</Trans></span>
              <span role="columnheader"><Trans>Created</Trans></span>
              <span role="columnheader"><Trans>Last used</Trans></span>
              <span role="columnheader" className="text-right"><Trans>Action</Trans></span>
            </div>
            {keys.map(key => (
              <div key={key.id} className="tbl__row" role="row">
                <div role="cell" className="dash-keys__name min-w-0">
                  <p className="tbl__name">{key.name}</p>
                  <p className="tbl__sub fig">{key.prefix}…</p>
                </div>
                <span role="cell" className="tbl__cell dash-keys__created">{formatRecordingDate(key.createdAt)}</span>
                <span role="cell" className="tbl__cell dash-keys__used">
                  <span className="dash-keys__label"><Trans>Last used</Trans></span>
                  {key.lastUsedAt ? formatRecordingDate(key.lastUsedAt) : <Trans>Never</Trans>}
                </span>
                <div role="cell" className="tbl__actions dash-keys__action">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(key)}>
                    <Trans>Revoke</Trans>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <form onSubmit={handleCreate} className="sheet dash-sheet">
        <h2 className="h-sec text-print"><Trans>New API key</Trans></h2>
        {newKey ? (
          <Notice>
            <p className="font-semibold text-ink"><Trans>Copy the key now. You will not see it again.</Trans></p>
            <code className="fig mt-2 block text-sm text-ink [overflow-wrap:anywhere]">{newKey}</code>
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => void copyKey()}>
              {copied ? <Check className="icon" aria-hidden="true" /> : <Copy className="icon" aria-hidden="true" />}
              {copied ? <Trans>Copied</Trans> : <Trans>Copy key</Trans>}
            </Button>
          </Notice>
        ) : null}
        <Input
          label={t`Name`}
          placeholder={t`For example: Booking system`}
          value={name}
          maxLength={60}
          onChange={e => setName(e.target.value)}
          required
        />
        {error && <p role="alert" className="field__help field__help--error">{error}</p>}
        <div className="dialog__actions">
          <Button type="submit" isLoading={saving} disabled={!name.trim() || saving}>
            <KeyRound className="icon" aria-hidden="true" />
            <Trans>Create key</Trans>
          </Button>
        </div>
      </form>

      <Modal isOpen={!!confirmRevoke} onClose={() => setConfirmRevoke(null)} ariaLabel={t`Revoke API key?`} className="dialog">
        <h3 className="dialog__title"><Trans>Revoke API key?</Trans></h3>
        <p><Trans>Requests with <span className="font-semibold">{confirmRevoke?.name}</span> stop working at once.</Trans></p>
        <div className="dialog__actions">
          <Button variant="secondary" onClick={() => setConfirmRevoke(null)}><Trans>Cancel</Trans></Button>
          <Button variant="danger" onClick={() => void handleRevoke()}><Trans>Revoke</Trans></Button>
        </div>
      </Modal>
    </div>
  );
};
