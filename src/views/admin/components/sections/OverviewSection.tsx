import { t } from '@lingui/core/macro';
import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Room } from '../../../../types';
import { Button, Skeleton } from '../../../../components/ui';
import { AdminHeader } from '../AdminHeader';
import { EmptyRecordings, LoadFailure, RecordingCards, RecordingsSkeleton, sortRecordings, type RecordingListItem } from '../RecordingsSection';
import { RoomMenu } from '../RoomMenu';
import { EmptyRooms, LiveTag, RoomAccessLabel, RoomsSkeleton, RoomsTable } from '../RoomsTable';

type OverviewSectionProps = {
  activeOrg: any;
  rooms: Room[];
  roomsLoading?: boolean;
  roomsFailed?: boolean;
  analytics: any;
  analyticsFailed?: boolean;
  notesAvailability?: Record<string, boolean>;
  recordings?: RecordingListItem[];
  recordingsFailed?: boolean;
  roomNames: Record<string, string>;
  onOpenCreate: () => void;
  onViewAllRooms: () => void;
  onViewAllRecordings: () => void;
  onOpenRecording: (recording: RecordingListItem) => void;
  onViewNotes: (room: Room) => void;
  onCopyLink: (room: Room) => void;
  onEditRoom: (room: Room) => void;
  onDeleteRoom: (room: Room) => void;
  onOpenRoom: (room: Room) => void;
  onJoinRoom?: (room: Room) => void;
};

const MAX_LIVE_ROOMS = 3;
const MAX_OTHER_ROOMS = 5;
const MAX_RECORDINGS = 3;

const SectionHead: React.FC<{ id: string; title: React.ReactNode; link?: React.ReactNode; onLink?: () => void; linkOnPhone?: boolean }> = ({ id, title, link, onLink, linkOnPhone = true }) => (
  <div className="dash-sec__head">
    <h2 id={id} className="h-sec">{title}</h2>
    {link ? <button type="button" className={`link dash-sec__link ${linkOnPhone ? '' : 'dash-sec__link--desk'}`} onClick={onLink}>{link}</button> : null}
  </div>
);

export const OverviewSection: React.FC<OverviewSectionProps> = ({
  activeOrg,
  rooms,
  roomsLoading = false,
  roomsFailed = false,
  analytics,
  analyticsFailed = false,
  notesAvailability,
  recordings,
  recordingsFailed = false,
  roomNames,
  onOpenCreate,
  onViewAllRooms,
  onViewAllRecordings,
  onOpenRecording,
  onViewNotes,
  onCopyLink,
  onEditRoom,
  onDeleteRoom,
  onOpenRoom,
  onJoinRoom = onOpenRoom,
}) => {
  const liveRooms = rooms.filter(room => room.activeParticipants > 0);
  const otherRooms = liveRooms.length ? rooms.filter(room => room.activeParticipants === 0) : rooms;
  const recentRecordings = recordings ? sortRecordings(recordings).slice(0, MAX_RECORDINGS) : [];
  const minutes = analytics?.recordings?.totalMinutes ?? 0;

  return (
    <div>
      <AdminHeader
        tight
        descriptionOnPhone
        title={activeOrg?.name || <Trans>Your workspace</Trans>}
        description={<Trans>Open a live room or create the next one.</Trans>}
      />

      {analyticsFailed ? (
        <LoadFailure><Trans>Metrics could not be loaded</Trans></LoadFailure>
      ) : analytics === undefined ? (
        <div className="stats dash-stats" role="status" aria-label={t`Loading dashboard metrics`}>
          {[1, 2, 3, 4].map(item => (
            <div key={item} className="stat">
              <Skeleton className="mb-2 h-2.5 w-[56%]" />
              <Skeleton className="h-5 w-2/5" />
            </div>
          ))}
        </div>
      ) : analytics === null ? (
        <div className="stats dash-stats grid-cols-1">
          <p className="muted py-3"><Trans>Usage metrics will appear after your first meeting.</Trans></p>
        </div>
      ) : (
        <div className="stats dash-stats">
          <div className="stat"><p className="stat__label"><Trans>Rooms</Trans></p><p className="stat__fig fig">{analytics.rooms?.total ?? rooms.length}</p></div>
          <div className="stat"><p className="stat__label"><Trans>Live now</Trans></p><p className="stat__fig fig">{analytics.rooms?.active ?? liveRooms.length}</p></div>
          <div className="stat"><p className="stat__label"><Trans>Sessions recorded</Trans></p><p className="stat__fig fig">{analytics.recordings?.total ?? 0}</p></div>
          <div className="stat"><p className="stat__label"><Trans>Recorded meeting time</Trans></p><p className="stat__fig fig"><Trans>{minutes} min</Trans></p></div>
        </div>
      )}

      <div className="dash-overview">
        <div className="dash-overview__main">
          <section className="dash-sec" aria-labelledby="live-rooms-heading">
            <SectionHead id="live-rooms-heading" title={<Trans>Live rooms</Trans>} link={<Trans>All rooms</Trans>} onLink={onViewAllRooms} linkOnPhone={false} />
            {roomsFailed ? (
              <LoadFailure><Trans>Rooms could not be loaded</Trans></LoadFailure>
            ) : roomsLoading ? (
              <RoomsSkeleton />
            ) : rooms.length === 0 ? (
              <EmptyRooms onOpenCreate={onOpenCreate} />
            ) : liveRooms.length === 0 ? (
              <div className="empty sheet">
                <p className="empty__title"><Trans>No rooms are live right now.</Trans></p>
                <Button variant="secondary" onClick={onViewAllRooms}><Trans>View your rooms</Trans></Button>
              </div>
            ) : (
              liveRooms.slice(0, MAX_LIVE_ROOMS).map(room => (
                <article key={room.id} className="stock dash-live">
                  <div className="min-w-0">
                    <h3 className="dash-live__name">{room.name}</h3>
                    <p className="tbl__sub dash-live__slug">/{room.slug}</p>
                  </div>
                  <RoomAccessLabel access={room.access} className="dash-live__access" />
                  <LiveTag count={room.activeParticipants} className="dash-live__tag" />
                  <div className="tbl__actions dash-live__actions">
                    <RoomMenu
                      room={room}
                      hasNotes={!!notesAvailability?.[room.id]}
                      onViewNotes={onViewNotes}
                      onCopyLink={onCopyLink}
                      onEdit={onEditRoom}
                      onDelete={onDeleteRoom}
                    />
                    <Button onClick={() => onJoinRoom(room)}><Trans>Join</Trans></Button>
                  </div>
                </article>
              ))
            )}
          </section>

          {!roomsLoading && otherRooms.length > 0 && (
            <section className="dash-sec" aria-labelledby="recent-rooms-heading">
              <SectionHead id="recent-rooms-heading" title={<Trans>Other rooms</Trans>} link={<Trans>Manage rooms</Trans>} onLink={onViewAllRooms} />
              <RoomsTable
                rooms={otherRooms}
                limit={MAX_OTHER_ROOMS}
                shortOnPhone
                notesAvailability={notesAvailability}
                onViewNotes={onViewNotes}
                onCopyLink={onCopyLink}
                onEdit={onEditRoom}
                onDelete={onDeleteRoom}
                onOpenRoom={onOpenRoom}
                onJoinRoom={onJoinRoom}
              />
            </section>
          )}
        </div>

        <section className="dash-sec" aria-labelledby="recent-recordings-heading">
          <SectionHead id="recent-recordings-heading" title={<Trans>Recordings</Trans>} link={<Trans>All recordings</Trans>} onLink={onViewAllRecordings} />
          {recordingsFailed ? (
            <LoadFailure><Trans>Recordings could not be loaded</Trans></LoadFailure>
          ) : recordings === undefined ? (
            <RecordingsSkeleton />
          ) : recentRecordings.length === 0 ? (
            <EmptyRecordings />
          ) : (
            <RecordingCards recordings={recentRecordings} roomNames={roomNames} onOpenRecording={onOpenRecording} />
          )}
        </section>
      </div>
    </div>
  );
};
