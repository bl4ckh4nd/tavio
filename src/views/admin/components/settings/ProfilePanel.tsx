import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { LogOut } from 'lucide-react';
import { Avatar, Button, Groove, Input } from '../../../../components/ui';
import { LanguageSwitcher } from '../../../../components/LanguageSwitcher';
import { useColorMode } from '../../../../hooks/useColorMode';

type ProfilePanelProps = {
  me: any;
  activeOrg: any;
  profileName: string;
  profileAvatarUrl: string;
  profileSaving: boolean;
  onProfileNameChange: (name: string) => void;
  onProfileAvatarUrlChange: (url: string) => void;
  onRestartOnboarding: () => void;
  onSaveProfile: () => void;
  onSignOut: () => void;
  signingOut: boolean;
};

const orgRoleLabel = (role?: string) => (role === 'OWNER' ? t`Owner` : role === 'ADMIN' ? t`Admin` : t`Member`);

export const ProfilePanel: React.FC<ProfilePanelProps> = ({
  me,
  activeOrg,
  profileName,
  profileAvatarUrl,
  profileSaving,
  onProfileNameChange,
  onProfileAvatarUrlChange,
  onRestartOnboarding,
  onSignOut,
  signingOut,
  onSaveProfile,
}) => {
  const { darkMode, setDarkMode } = useColorMode();

  return (
    <div className="dash-columns dash-columns--7-5">
      <section className="sheet dash-sheet">
        <div className="dash-sheet__head">
          <Avatar name={profileName || me?.name || 'User'} src={profileAvatarUrl || me?.avatarUrl} size="lg" />
          <div className="min-w-0">
            <h2 className="h-sec text-print"><Trans>Profile Details</Trans></h2>
            <p className="muted max-sm:hidden"><Trans>Set an avatar URL to personalize your profile.</Trans></p>
          </div>
        </div>
        <div className="dash-fields">
          <Input
            label={t`Display Name`}
            value={profileName}
            onChange={e => onProfileNameChange(e.target.value)}
          />
          <Input label={t`Email Address`} value={me?.email || ''} disabled />
          <Input
            label={t`Avatar URL`}
            value={profileAvatarUrl}
            onChange={e => onProfileAvatarUrlChange(e.target.value)}
            placeholder="https://example.com/avatar.png"
          />
          <Input label={t`Role`} value={orgRoleLabel(activeOrg?.role)} disabled />
        </div>
        <div className="dash-sheet__actions">
          <Button variant="secondary" onClick={onRestartOnboarding}>
            <Trans>Restart onboarding</Trans>
          </Button>
          <Button onClick={onSaveProfile} isLoading={profileSaving} disabled={profileSaving}>
            <Trans>Save Changes</Trans>
          </Button>
        </div>
      </section>

      <div className="dash-aside">
        {activeOrg && (
          <section>
            <h2 className="h-sec dash-aside__title--tight"><Trans>Workspace Details</Trans></h2>
            <p className="muted dash-aside__note"><Trans>Your current workspace. To switch workspaces, use a different email.</Trans></p>
            <div className="record__rows">
              <div className="record__row"><span><Trans>Name</Trans></span><span>{activeOrg.name}</span></div>
              <div className="record__row"><span><Trans>Slug</Trans></span><span className="fig text-xs">{activeOrg.slug}</span></div>
              <div className="record__row"><span><Trans>Role</Trans></span><span>{orgRoleLabel(activeOrg.role)}</span></div>
            </div>
          </section>
        )}

        {activeOrg && (
          <section>
            <h2 className="h-sec dash-aside__title"><Trans>Language</Trans></h2>
            <LanguageSwitcher variant="field" />
          </section>
        )}

        <section>
          <h2 className="h-sec dash-aside__title"><Trans>Appearance</Trans></h2>
          <Groove
            wide
            ariaLabel={t`Appearance`}
            value={darkMode ? 'dark' : 'light'}
            onChange={mode => setDarkMode(mode === 'dark')}
            options={[
              { value: 'light', label: <Trans>Light</Trans> },
              { value: 'dark', label: <Trans>Dark</Trans> },
            ]}
          />
        </section>

        <section>
          <h2 className="h-sec dash-aside__title"><Trans>Account</Trans></h2>
          <Button variant="secondary" className="w-full" onClick={onSignOut} isLoading={signingOut} disabled={signingOut}>
            <LogOut className="icon" aria-hidden="true" />
            <Trans>Sign out</Trans>
          </Button>
        </section>
      </div>
    </div>
  );
};
