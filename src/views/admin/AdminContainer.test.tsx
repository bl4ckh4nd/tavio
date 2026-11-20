import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRoom } from '../../../tests/helpers/fixtures';

const { controllerState } = vi.hoisted(() => ({ controllerState: { current: {} as Record<string, unknown> } }));

vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@lingui/core/macro', () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, part, idx) => `${acc}${part}${values[idx] ?? ''}`, ''),
  msg: (strings: TemplateStringsArray) => ({ id: strings[0] }),
}));

vi.mock('@lingui/react', () => ({
  useLingui: () => ({ _: (descriptor: { id: string }) => descriptor.id, i18n: { locale: 'en', _: (d: { message: string }) => d.message } }),
}));

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => undefined),
  useQueries: vi.fn(() => ({})),
  useMutation: vi.fn(() => vi.fn()),
  useAction: vi.fn(() => vi.fn()),
}));

vi.mock('../../components/ToastProvider', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('../../lib/i18n', () => ({ SUPPORTED_LOCALES: ['en'], LOCALE_NAMES: { en: 'English' }, loadCatalog: vi.fn(), persistLocale: vi.fn() }));
vi.mock('./hooks/useAdminController', () => ({ useAdminController: () => controllerState.current }));

import { AdminContainer } from './AdminContainer';
import { AppView } from '../../types';

const noop = () => {};
const baseController = (overrides: Record<string, unknown> = {}) => ({
  activeTab: 'OVERVIEW', setActiveTab: vi.fn(), settingsTab: 'PROFILE', setSettingsTab: vi.fn(),
  selectedRoomForNotes: null, setSelectedRoomForNotes: noop, confirmDeleteRoom: null, setConfirmDeleteRoom: noop,
  modalOpen: false, setModalOpen: vi.fn(), editingRoom: null, roomsSearchInput: '', setRoomsSearchInput: vi.fn(), roomsSearchTerm: '',
  roomsLoading: false, showTour: false, showChecklist: false, checklistItems: [], profileName: 'Priya', setProfileName: noop,
  profileAvatarUrl: '', setProfileAvatarUrl: noop, profileSaving: false, activeOrg: { name: 'Design Studio', slug: 'design-studio', role: 'OWNER' },
  me: { name: 'Priya', email: 'priya@example.com' }, billing: null, analytics: { rooms: { total: 2, active: 1 }, recordings: { total: 14, totalMinutes: 412 } },
  notesAvailability: {}, recordings: [], selectedRecording: null, selectedRecordingId: null, selectedRecordingTranscript: undefined, setSelectedRecordingId: noop,
  selectedRoomDoc: null, billingLoading: false, billingError: null, filteredRooms: [], handleOpenCreate: vi.fn(), handleOpenEdit: noop, handleSaveRoom: noop,
  handleSaveProfile: noop, handleRequestDeleteRoom: noop, handleConfirmDeleteRoom: noop, handleCopyRoomLink: noop, handleOpenNotes: noop,
  handleDismissTour: noop, handleDismissChecklist: noop, handleRestartOnboarding: noop, handleUpgradeToPro: vi.fn(), openBillingTab: vi.fn(), handleOpenRecording: vi.fn(),
  ...overrides,
});

const renderAdmin = (overrides: Record<string, unknown> = {}, rooms = [makeRoom({ id: 'r1', name: 'Live room', slug: 'live', activeParticipants: 3 }), makeRoom({ id: 'r2', name: 'Quiet room', slug: 'quiet', activeParticipants: 0 })]) => {
  const controller = baseController({ filteredRooms: rooms, ...overrides });
  controllerState.current = controller;
  const onNavigate = vi.fn();
  render(<AdminContainer onNavigate={onNavigate} rooms={rooms} onCreateRoom={vi.fn()} onUpdateRoom={vi.fn()} onDeleteRoom={vi.fn()} />);
  return { controller, onNavigate };
};

describe('AdminContainer', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove('dark');
  });

  it.each(['OVERVIEW', 'ROOMS', 'RECORDINGS', 'SETTINGS'])('offers New Room in the top bar on the %s tab, with search only on Rooms', (activeTab) => {
    const { controller } = renderAdmin({ activeTab });
    const header = document.getElementById('admin-new-room-btn')!;
    fireEvent.click(within(header).getByRole('button', { name: /New Room/ }));
    expect(controller.handleOpenCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByPlaceholderText('Search by name or slug...')).toHaveLength(activeTab === 'ROOMS' ? 1 : 0);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('heads Overview with the workspace and shows the four figures', () => {
    renderAdmin();
    expect(screen.getByRole('heading', { level: 1, name: 'Design Studio' })).toBeInTheDocument();
    for (const label of ['Live now', 'Sessions recorded', 'Recorded meeting time']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('412 min')).toHaveClass('stat__fig', 'fig');
  });

  it('shows real loading states instead of "no rooms" while the queries are pending', () => {
    renderAdmin({ roomsLoading: true, analytics: undefined, recordings: undefined }, []);
    expect(screen.getByRole('status', { name: 'Loading rooms' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading dashboard metrics' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading recordings' })).toBeInTheDocument();
    expect(screen.queryByText('No rooms yet. Create one to get started.')).toBeNull();
  });

  it('opens the create panel from the empty state, and clears a search that found nothing', () => {
    const { controller } = renderAdmin({ activeTab: 'ROOMS' }, []);
    fireEvent.click(within(screen.getByText('No rooms yet. Create one to get started.').parentElement!).getByRole('button', { name: /New Room/ }));
    expect(controller.handleOpenCreate).toHaveBeenCalled();
    cleanup();

    const searched = renderAdmin({ activeTab: 'ROOMS', roomsSearchInput: 'xyz', roomsSearchTerm: 'xyz' }, []);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(searched.controller.setRoomsSearchInput).toHaveBeenCalledWith('');
  });

  it('marks a failed recording with a word and an icon, without opening another way', () => {
    const recording = { id: 'a', roomId: 'r2', status: 'failed', transcriptStatus: 'failed', startedAt: 1, durationMs: 60000 };
    const { controller } = renderAdmin({ activeTab: 'RECORDINGS', recordings: [recording] });
    const status = screen.getByText('Failed');
    expect(status).toHaveClass('tag', 'tag--outline');
    expect(status.querySelector('svg')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open recording' }));
    expect(controller.handleOpenRecording).toHaveBeenCalledWith(recording);
  });

  it('switches settings by groove, and Billing goes through its own handler', () => {
    const { controller } = renderAdmin({ activeTab: 'SETTINGS' });
    const groove = screen.getByRole('group', { name: 'Settings' });
    fireEvent.click(within(groove).getByRole('button', { name: 'Team Members' }));
    expect(controller.setSettingsTab).toHaveBeenCalledWith('TEAM');
    fireEvent.click(within(groove).getByRole('button', { name: 'Billing' }));
    expect(controller.openBillingTab).toHaveBeenCalledTimes(1);
    expect(controller.setSettingsTab).toHaveBeenCalledTimes(1);
  });

  it('sets the colour mode from the Appearance groove in Profile', () => {
    renderAdmin({ activeTab: 'SETTINGS' });
    const groove = screen.getByRole('group', { name: 'Appearance' });
    fireEvent.click(within(groove).getByRole('button', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(within(groove).getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(groove).getByRole('button', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('labels billing through the catalog and retries a failed upgrade', () => {
    const { controller } = renderAdmin({
      activeTab: 'SETTINGS',
      settingsTab: 'BILLING',
      billing: { planName: 'Free', status: 'past_due', limits: { maxRooms: 3, recordingMinutesIncluded: 0 }, usage: { roomsCount: 2, recordingMinutesUsed: 0 } },
      billingError: 'Upgrade is not available right now',
    });
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Past due')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Upgrade is not available right now');
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(controller.handleUpgradeToPro).toHaveBeenCalledTimes(1);
  });

  it('keeps the room form in a dialog, with its validation and the way to billing', () => {
    const { controller } = renderAdmin({ activeTab: 'ROOMS', modalOpen: true });
    const dialog = screen.getByRole('dialog', { name: 'Create New Room' });
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Room' }));
    expect(within(dialog).getByText('Room name is required')).toBeInTheDocument();

    const access = within(dialog).getByRole('group', { name: 'Who can join?' });
    expect(within(dialog).queryByLabelText('Room password')).toBeNull();
    fireEvent.click(within(access).getByRole('button', { name: 'Password protected' }));
    expect(within(dialog).getByLabelText('Room password')).toBeInTheDocument();
    expect(within(dialog).getByText('Public link with passcode')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Upgrade to Pro' }));
    expect(controller.setModalOpen).toHaveBeenCalledWith(false);
    expect(controller.setActiveTab).toHaveBeenCalledWith('SETTINGS');
    expect(controller.openBillingTab).toHaveBeenCalledTimes(1);
  });

  it('navigates to help from the top bar', () => {
    const { onNavigate } = renderAdmin();
    fireEvent.click(within(document.getElementById('admin-new-room-btn')!).getAllByRole('button', { name: /Help & Docs/ })[0]);
    expect(onNavigate).toHaveBeenCalledWith(AppView.DOCS);
  });
});
