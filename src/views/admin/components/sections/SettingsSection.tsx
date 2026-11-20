import { t } from '@lingui/core/macro';
import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Groove } from '../../../../components/ui';
import { SettingsTab } from '../../types';
import { AdminHeader } from '../AdminHeader';
import { BillingPanel } from '../settings/BillingPanel';
import { ProfilePanel } from '../settings/ProfilePanel';
import { ApiKeysPanel } from '../settings/ApiKeysPanel';
import { TeamSettingsCard } from '../TeamSettingsCard';

type SettingsSectionProps = {
  settingsTab: SettingsTab;
  onSettingsTabChange: (tab: SettingsTab) => void;
  onOpenBilling: () => void;
  activeOrg: any;
  me: any;
  profileName: string;
  profileAvatarUrl: string;
  profileSaving: boolean;
  onProfileNameChange: (name: string) => void;
  onProfileAvatarUrlChange: (url: string) => void;
  onRestartOnboarding: () => void;
  onSaveProfile: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  billing: any;
  billingLoading: boolean;
  billingError: string | null;
  onUpgradeToPro: () => void;
};

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  settingsTab,
  onSettingsTabChange,
  onOpenBilling,
  activeOrg,
  me,
  profileName,
  profileAvatarUrl,
  profileSaving,
  onProfileNameChange,
  onProfileAvatarUrlChange,
  onRestartOnboarding,
  onSaveProfile,
  onSignOut,
  signingOut,
  billing,
  billingLoading,
  billingError,
  onUpgradeToPro,
}) => (
  <div>
    <AdminHeader title={<Trans>Settings</Trans>}>
      <Groove<SettingsTab>
        ariaLabel={t`Settings`}
        value={settingsTab}
        // Billing keeps its own handler, which also ticks the onboarding task.
        onChange={tab => (tab === 'BILLING' ? onOpenBilling() : onSettingsTabChange(tab))}
        options={[
          { value: 'PROFILE', label: <Trans>My Profile</Trans> },
          { value: 'TEAM', label: <Trans>Team Members</Trans> },
          { value: 'BILLING', label: <Trans>Billing</Trans> },
          { value: 'API', label: <Trans>API</Trans> },
        ]}
      />
    </AdminHeader>

    {settingsTab === 'PROFILE' && (
      <ProfilePanel
        me={me}
        activeOrg={activeOrg}
        profileName={profileName}
        profileAvatarUrl={profileAvatarUrl}
        profileSaving={profileSaving}
        onProfileNameChange={onProfileNameChange}
        onProfileAvatarUrlChange={onProfileAvatarUrlChange}
        onRestartOnboarding={onRestartOnboarding}
        onSaveProfile={onSaveProfile}
        onSignOut={onSignOut}
        signingOut={signingOut}
      />
    )}

    {settingsTab === 'TEAM' && <TeamSettingsCard />}

    {settingsTab === 'API' && <ApiKeysPanel />}

    {settingsTab === 'BILLING' && (
      <BillingPanel
        billing={billing}
        billingLoading={billingLoading}
        billingError={billingError}
        activeOrg={activeOrg}
        onUpgradeToPro={onUpgradeToPro}
      />
    )}
  </div>
);
