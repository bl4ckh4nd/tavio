import React, { useMemo } from 'react';
import { useLingui } from '@lingui/react';
import { OnboardingChecklist } from '../../components/OnboardingChecklist';
import { OnboardingTour } from '../../components/OnboardingTour';
import { AdminTopBar } from './components/AdminTopBar';
import { MobileTabNav } from './components/MobileTabNav';
import { DeleteConfirmModal } from './components/modals/DeleteConfirmModal';
import { NotesModal } from './components/modals/NotesModal';
import { RoomModal } from './components/modals/RoomModal';
import { OverviewSection } from './components/sections/OverviewSection';
import { RoomsSection } from './components/sections/RoomsSection';
import { SettingsSection } from './components/sections/SettingsSection';
import { RecordingsSection } from './components/RecordingsSection';
import { RecordingViewerModal } from './components/RecordingViewerModal';
import { TOUR_STEPS } from './constants';
import { useAdminController } from './hooks/useAdminController';
import { RoomPage } from './room/RoomPage';
import { SessionPage } from './room/SessionPage';
import { AdminProps, AdminTab } from './types';
import { AppView, Room } from '../../types';

export const AdminContainer: React.FC<AdminProps> = ({
  onNavigate, rooms, onCreateRoom, onUpdateRoom, onDeleteRoom,
  roomSlug, sessionId, initialTab, onOpenRoomPage, onOpenSession, onLeaveRoomPage,
}) => {
  const controller = useAdminController({
    rooms,
    onCreateRoom,
    onUpdateRoom,
    onDeleteRoom,
    initialTab,
  });
  const { _ } = useLingui();
  const tourSteps = useMemo(
    () => TOUR_STEPS.map((step) => ({ ...step, title: _(step.title), content: _(step.content) })),
    [_],
  );
  const roomNames = useMemo(() => Object.fromEntries(rooms.map(room => [room.id, room.name])), [rooms]);
  const handleJoinRoom = (room: Room) => onNavigate(AppView.LOBBY, room.slug);
  // "Open" leads to the room's own page; without one (embedded use) it still opens the lobby.
  const handleOpenRoom = (room: Room) => (onOpenRoomPage ? onOpenRoomPage(room.slug) : handleJoinRoom(room));
  // The room page and a session's page sit under Rooms; a tab leaves them.
  const onRoomPage = roomSlug !== undefined;
  const pageRoom = onRoomPage ? rooms.find(room => room.slug === roomSlug) : undefined;
  const activeTab = onRoomPage ? 'ROOMS' : controller.activeTab;
  const handleTabChange = (tab: AdminTab) => {
    controller.setActiveTab(tab);
    if (onRoomPage) onLeaveRoomPage?.(tab);
  };

  return (
    <div className="g-paper phone">
      <OnboardingTour
        steps={tourSteps}
        isOpen={controller.showTour}
        onClose={controller.handleDismissTour}
        onComplete={controller.handleDismissTour}
      />

      {controller.showChecklist && (
        <OnboardingChecklist
          items={controller.checklistItems}
          onDismiss={controller.handleDismissChecklist}
        />
      )}

      <AdminTopBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onNavigate={onNavigate}
        onOpenCreate={controller.handleOpenCreate}
        me={controller.me}
        onOpenProfile={() => { controller.setSettingsTab('PROFILE'); handleTabChange('SETTINGS'); }}
      />

      <main className="phone__body min-w-0">
        <div className="wrap dash-page">
          {onRoomPage && (sessionId ? (
            <SessionPage
              sessionId={sessionId}
              roomName={pageRoom?.name}
              onBack={() => onOpenRoomPage?.(roomSlug)}
              onOpenRecordings={() => handleTabChange('RECORDINGS')}
            />
          ) : (
            <RoomPage
              room={pageRoom}
              roomsLoading={controller.roomsLoading}
              onBack={() => handleTabChange('ROOMS')}
              onJoin={handleJoinRoom}
              onCopyLink={controller.handleCopyRoomLink}
              onOpenSession={(id) => onOpenSession?.(roomSlug, id)}
            />
          ))}

          {!onRoomPage && controller.activeTab === 'OVERVIEW' && (
            <OverviewSection
              activeOrg={controller.activeOrg}
              rooms={rooms}
              roomsLoading={controller.roomsLoading}
              roomsFailed={controller.roomsFailed}
              analytics={controller.analytics}
              analyticsFailed={controller.analyticsFailed}
              notesAvailability={controller.notesAvailability}
              recordings={controller.recordings}
              recordingsFailed={controller.recordingsFailed}
              roomNames={roomNames}
              onOpenCreate={controller.handleOpenCreate}
              onViewAllRooms={() => controller.setActiveTab('ROOMS')}
              onViewAllRecordings={() => controller.setActiveTab('RECORDINGS')}
              onOpenRecording={controller.handleOpenRecording}
              onViewNotes={controller.handleOpenNotes}
              onCopyLink={controller.handleCopyRoomLink}
              onEditRoom={controller.handleOpenEdit}
              onDeleteRoom={controller.handleRequestDeleteRoom}
              onOpenRoom={handleOpenRoom}
              onJoinRoom={handleJoinRoom}
            />
          )}

          {!onRoomPage && controller.activeTab === 'ROOMS' && (
            <RoomsSection
              roomsSearchInput={controller.roomsSearchInput}
              onRoomsSearchChange={controller.setRoomsSearchInput}
              onOpenCreate={controller.handleOpenCreate}
              filteredRooms={controller.filteredRooms}
              roomsLoading={controller.roomsLoading}
              roomsFailed={controller.roomsFailed}
              roomsSearchTerm={controller.roomsSearchTerm}
              notesAvailability={controller.notesAvailability}
              onViewNotes={controller.handleOpenNotes}
              onCopyLink={controller.handleCopyRoomLink}
              onEditRoom={controller.handleOpenEdit}
              onDeleteRoom={controller.handleRequestDeleteRoom}
              onOpenRoom={handleOpenRoom}
              onJoinRoom={handleJoinRoom}
            />
          )}

          {!onRoomPage && controller.activeTab === 'SETTINGS' && (
            <SettingsSection
              settingsTab={controller.settingsTab}
              onSettingsTabChange={controller.setSettingsTab}
              onOpenBilling={controller.openBillingTab}
              activeOrg={controller.activeOrg}
              me={controller.me}
              profileName={controller.profileName}
              profileAvatarUrl={controller.profileAvatarUrl}
              profileSaving={controller.profileSaving}
              onProfileNameChange={controller.setProfileName}
              onProfileAvatarUrlChange={controller.setProfileAvatarUrl}
              onRestartOnboarding={controller.handleRestartOnboarding}
              onSaveProfile={controller.handleSaveProfile}
              onSignOut={controller.handleSignOut}
              signingOut={controller.signingOut}
              billing={controller.billing}
              billingLoading={controller.billingLoading}
              billingError={controller.billingError}
              onUpgradeToPro={controller.handleUpgradeToPro}
            />
          )}

          {!onRoomPage && controller.activeTab === 'RECORDINGS' && (
            <RecordingsSection
              recordings={controller.recordings}
              failed={controller.recordingsFailed}
              roomNames={roomNames}
              onOpenRecording={controller.handleOpenRecording}
            />
          )}
        </div>
      </main>

      <MobileTabNav activeTab={activeTab} onTabChange={handleTabChange} />

      <RoomModal
        isOpen={controller.modalOpen}
        onClose={() => controller.setModalOpen(false)}
        onSave={controller.handleSaveRoom}
        initialData={controller.editingRoom || undefined}
        rooms={rooms}
        onOpenBilling={() => {
          controller.setModalOpen(false);
          controller.setActiveTab('SETTINGS');
          controller.openBillingTab();
        }}
      />

      <DeleteConfirmModal
        room={controller.confirmDeleteRoom}
        onCancel={() => controller.setConfirmDeleteRoom(null)}
        onConfirm={controller.handleConfirmDeleteRoom}
      />

      <NotesModal
        room={controller.selectedRoomForNotes}
        doc={controller.selectedRoomDoc}
        hasNotes={!!(controller.selectedRoomForNotes && controller.notesAvailability?.[controller.selectedRoomForNotes.id])}
        onClose={() => controller.setSelectedRoomForNotes(null)}
      />

      <RecordingViewerModal
        recording={controller.selectedRecording}
        transcript={controller.selectedRecordingTranscript}
        transcriptLoading={controller.selectedRecordingId !== null && controller.selectedRecordingTranscript === undefined}
        roomName={controller.selectedRecording ? rooms.find(room => room.id === controller.selectedRecording.roomId)?.name : undefined}
        onClose={() => controller.setSelectedRecordingId(null)}
      />
    </div>
  );
};
