import { t } from '@lingui/core/macro';
import React from 'react';
import { Trans } from '@lingui/react/macro';
import { BookOpen, Plus } from 'lucide-react';
import { AppView } from '../../../types';
import { Avatar, Button, IconButton } from '../../../components/ui';
import { BrandMark } from '../../../components/BrandMark';
import { AdminTab } from '../types';

type AdminTopBarProps = {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  onNavigate: (view: AppView, param?: string) => void;
  onOpenCreate: () => void;
  onOpenProfile: () => void;
  me: any;
};

const navItems: Array<{ tab: AdminTab; label: React.ReactNode; id?: string }> = [
  { tab: 'OVERVIEW', label: <Trans>Overview</Trans> },
  { tab: 'ROOMS', label: <Trans>Rooms</Trans>, id: 'admin-nav-rooms' },
  { tab: 'RECORDINGS', label: <Trans>Recordings</Trans> },
  { tab: 'SETTINGS', label: <Trans>Settings</Trans> },
];

export const AdminTopBar: React.FC<AdminTopBarProps> = ({ activeTab, onTabChange, onNavigate, onOpenCreate, onOpenProfile, me }) => (
  // The id is what the tour and the e2e spec point at; it predates the move from a sidebar to a top bar.
  <header id="admin-sidebar" className="bar dash-bar sticky top-0 z-30">
    <button type="button" onClick={() => onNavigate(AppView.LANDING)} className="flex flex-none cursor-pointer" aria-label={t`Tavio home`}>
      <BrandMark logoClassName="bar__logo" />
    </button>
    <nav className="tabs max-lg:hidden" aria-label={t`Workspace navigation`}>
      {navItems.map(item => (
        <div key={item.tab} id={item.id} className="flex">
          <button
            type="button"
            onClick={() => onTabChange(item.tab)}
            aria-current={activeTab === item.tab ? 'page' : undefined}
            className={`tab ${activeTab === item.tab ? 'is-on' : ''}`}
          >
            {item.label}
          </button>
        </div>
      ))}
    </nav>
    <div className="bar__end">
      <div id="admin-new-room-btn" className="flex items-center gap-3 max-sm:gap-1">
        <button type="button" className="tab min-h-10 gap-1 max-sm:hidden" onClick={() => onNavigate(AppView.DOCS)}>
          <BookOpen className="icon" aria-hidden="true" />
          <span><Trans>Help & Docs</Trans></span>
        </button>
        <Button variant="secondary" className="dash-bar__new max-sm:min-h-8 max-sm:px-3" onClick={onOpenCreate}>
          <Plus className="icon" aria-hidden="true" />
          <span><Trans>New Room</Trans></span>
        </Button>
        <IconButton label={t`Help & Docs`} className="sm:hidden" onClick={() => onNavigate(AppView.DOCS)}>
          <BookOpen className="icon" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="bar__who min-w-0 max-sm:hidden lg:max-xl:hidden">
        <p className="bar__name truncate">{me?.name || <Trans>Loading...</Trans>}</p>
        <p className="bar__mail truncate">{me?.email || ''}</p>
      </div>
      <button type="button" className="dash-bar__me" onClick={onOpenProfile} aria-label={t`Profile and sign out`} title={t`Profile and sign out`}>
        <Avatar name={me?.name || 'User'} src={me?.avatarUrl} size="sm" />
      </button>
    </div>
  </header>
);
