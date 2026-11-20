import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Avatar, Button, Select } from '../../../components/ui';

export const RoomMembershipEditor: React.FC<{ roomId: string }> = ({ roomId }) => {
  const memberships = useQuery(api.memberships.listForRoom, { roomId: roomId as any }) || [];
  const users = useQuery(api.users.list, {}) || [];
  const addMembership = useMutation(api.memberships.add);
  const removeMembership = useMutation(api.memberships.remove);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [role, setRole] = useState<'Host' | 'Participant' | 'Admin'>('Participant');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    // React bubbles the submit into the room form this editor sits inside, which would save the whole room.
    e.stopPropagation();
    if (!selectedUserId) return;
    setSaving(true);
    try {
      await addMembership({ roomId: roomId as any, userId: selectedUserId, role });
      setError(null);
    } catch (err) {
      console.error('Failed to add membership', err);
      setError(t`Could not save membership`);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeMembership({ id: id as any });
    } catch (err) {
      console.error('Failed to remove membership', err);
      setError(t`Could not remove membership`);
    }
  };

  const options = users.map((u: any) => ({
    label: `${u.name ?? t`User`} (${u.externalId})`,
    value: u.externalId as string,
  }));

  return (
    <div className="dash-members">
      <div className="dash-members__head">
        <h4 className="dash-members__title"><Trans>Room Members</Trans></h4>
        <span className="field__help"><Trans>Access is enforced via Convex memberships</Trans></span>
      </div>

      <div>
        {memberships.length === 0 && (
          <p className="field__help">
            <Trans>No explicit members yet. For members-only rooms, the first joiner becomes Host.</Trans>
          </p>
        )}
        {memberships.map((m: any) => {
          const user = users.find((u: any) => u.externalId === m.userId);
          return (
            <div key={m.id} className="dash-members__row">
              <div className="dash-team__who">
                <Avatar name={user?.name ?? m.userId} size="sm" />
                <div className="min-w-0">
                  <p className="tbl__name">{user?.name ?? m.userId}</p>
                  <p className="field__help">{m.role}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" type="button" onClick={() => handleRemove(m.id)}>
                <Trans>Remove</Trans>
              </Button>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleAdd} className="dash-members__add">
        <Select
          aria-label={t`Select user…`}
          value={selectedUserId}
          onChange={e => setSelectedUserId(e.target.value)}
        >
          <option value=""><Trans>Select user…</Trans></option>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Select
          aria-label={t`Role`}
          value={role}
          onChange={e => setRole(e.target.value as any)}
        >
          <option value="Host"><Trans>Host</Trans></option>
          <option value="Participant"><Trans>Participant</Trans></option>
          <option value="Admin"><Trans>Admin</Trans></option>
        </Select>
        <Button type="submit" variant="secondary" isLoading={saving} disabled={!selectedUserId || saving}>
          <Trans>Add</Trans>
        </Button>
      </form>
      {error && <p role="alert" className="field__help field__help--error">{error}</p>}
    </div>
  );
};
