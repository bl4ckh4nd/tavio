import { t } from '@lingui/core/macro';
import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Captions, LayoutDashboard, Settings, Video } from 'lucide-react';
import { AdminTab } from '../types';

type MobileTabNavProps = {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
};

const items: Array<{ tab: AdminTab; icon: React.ReactNode; label: React.ReactNode; id?: string }> = [
  { tab: 'OVERVIEW', icon: <LayoutDashboard className="icon" aria-hidden="true" />, label: <Trans>Overview</Trans> },
  { tab: 'ROOMS', icon: <Video className="icon" aria-hidden="true" />, label: <Trans>Rooms</Trans>, id: 'admin-nav-rooms-mobile' },
  { tab: 'RECORDINGS', icon: <Captions className="icon" aria-hidden="true" />, label: <Trans>Recordings</Trans> },
  { tab: 'SETTINGS', icon: <Settings className="icon" aria-hidden="true" />, label: <Trans>Settings</Trans> },
];

export const MobileTabNav: React.FC<MobileTabNavProps> = ({ activeTab, onTabChange }) => (
  <nav className="tabbar z-30 lg:hidden" aria-label={t`Workspace navigation`}>
    {items.map(item => (
      <button
        key={item.tab}
        id={item.id}
        type="button"
        onClick={() => onTabChange(item.tab)}
        aria-current={activeTab === item.tab ? 'page' : undefined}
        className={`tabbar__item ${activeTab === item.tab ? 'is-on' : ''}`}
      >
        {item.icon}<span>{item.label}</span>
      </button>
    ))}
  </nav>
);
