import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { UserPlus } from 'lucide-react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Avatar, Button, Input, Select, Skeleton } from '../../../components/ui';

const COLUMNS = { '--cols': 'minmax(0, 1fr) 180px 104px' } as React.CSSProperties;

export const TeamSettingsCard: React.FC = () => {
  const orgs = useQuery(api.organizations.listForCurrentUser, {}) || [];
  const membersQuery = useQuery(api.orgMembers.list, {});
  const members = membersQuery || [];
  const invite = useMutation(api.orgMembers.invite);
  const updateRole = useMutation(api.orgMembers.updateRole);
  const removeMembership = useMutation(api.orgMembers.remove);

  const myOrgRole = orgs[0]?.role as string | undefined;
  const canManage = myOrgRole === 'OWNER' || myOrgRole === 'ADMIN';

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setSaving(true);
    try {
      await invite({
        email: inviteEmail,
        name: inviteName || undefined,
        role: inviteRole,
      });
      setError(null);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('MEMBER');
    } catch (err) {
      console.error('Failed to invite member', err);
      setError(t`Could not invite member`);
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (membershipId: string, role: 'ADMIN' | 'MEMBER') => {
    try {
      await updateRole({ membershipId: membershipId as any, role });
    } catch (err) {
      console.error('Failed to update role', err);
    }
  };

  const handleRemove = async (membershipId: string) => {
    try {
      await removeMembership({ membershipId: membershipId as any });
    } catch (err) {
      console.error('Failed to remove member', err);
    }
  };

  return (
    <div className="dash-columns dash-columns--8-4">
      <section className="dash-sec">
        <div className="dash-sec__head block">
          <h2 className="h-sec"><Trans>Team Members</Trans></h2>
          <p className="muted mt-0.5"><Trans>Manage team access and assign roles.</Trans></p>
          {!canManage && (
            <p className="muted mt-0.5"><Trans>Only organization owners and admins can invite or remove members.</Trans></p>
          )}
        </div>

        {membersQuery === undefined ? (
          <div className="tbl" role="status" aria-label={t`Team Members`} style={COLUMNS}>
            {[1, 2, 3].map(item => (
              <div key={item} className="tbl__row dash-skel-row">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="muted"><Trans>No team members yet. Invite someone by email to get started.</Trans></p>
        ) : (
          <div className="tbl dash-team" role="table" aria-label={t`Team Members`} style={COLUMNS}>
            <div className="tbl__row tbl__row--head" role="row">
              <span role="columnheader"><Trans>Name</Trans></span>
              <span role="columnheader"><Trans>Role</Trans></span>
              <span role="columnheader" className="text-right"><Trans>Action</Trans></span>
            </div>
            {members.map((m: any) => {
              const isOwner = m.orgRole === 'OWNER';
              return (
                <div key={m.membershipId} className="tbl__row" role="row">
                  <div role="cell" className="dash-team__who">
                    <Avatar name={m.name ?? 'User'} size="sm" />
                    <div className="min-w-0">
                      <p className="tbl__name">{m.name ?? t`Member`}</p>
                      <p className="tbl__sub">{m.email}</p>
                    </div>
                  </div>
                  <div role="cell" className="dash-team__role">
                    {isOwner ? (
                      <span className="tbl__cell"><Trans>Owner</Trans></span>
                    ) : (
                      <Select
                        aria-label={t`Role`}
                        className="input--s"
                        value={m.orgRole}
                        onChange={e =>
                          handleRoleChange(
                            m.membershipId as string,
                            e.target.value as 'ADMIN' | 'MEMBER',
                          )
                        }
                        disabled={!canManage}
                      >
                        <option value="MEMBER"><Trans>Member</Trans></option>
                        <option value="ADMIN"><Trans>Admin</Trans></option>
                      </Select>
                    )}
                  </div>
                  <div role="cell" className="tbl__actions dash-team__action">
                    {!isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(m.membershipId as string)}
                        disabled={!canManage}
                      >
                        <Trans>Remove</Trans>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {canManage && (
        <form onSubmit={handleInvite} className="sheet dash-sheet">
          <h2 className="h-sec text-print"><Trans>Invite Member</Trans></h2>
          <Input
            label={t`Email`}
            type="email"
            placeholder="member@company.com"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
          />
          <Input
            label={t`Name (optional)`}
            placeholder={t`Full name`}
            value={inviteName}
            onChange={e => setInviteName(e.target.value)}
          />
          <Select
            label={t`Role`}
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value as 'ADMIN' | 'MEMBER')}
          >
            <option value="MEMBER"><Trans>Member</Trans></option>
            <option value="ADMIN"><Trans>Admin</Trans></option>
          </Select>
          {error && <p role="alert" className="field__help field__help--error">{error}</p>}
          <div className="dialog__actions">
            <Button type="submit" isLoading={saving} disabled={!inviteEmail || saving}>
              <UserPlus className="icon" aria-hidden="true" />
              <Trans>Send Invite</Trans>
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
