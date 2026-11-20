import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { Globe, Lock, Plus, Users } from 'lucide-react';
import { Room, RoomAccess } from '../../../types';
import { Button, Skeleton, Tag } from '../../../components/ui';
import { RoomMenu, type RoomMenuActions } from './RoomMenu';

type RoomsTableProps = RoomMenuActions & {
  rooms: Room[];
  limit?: number;
  // Five rows on the desktop, three on the phone, as drawn for Overview.
  shortOnPhone?: boolean;
  notesAvailability?: Record<string, boolean>;
  /** Opens the room's page with its history. */
  onOpenRoom: (room: Room) => void;
  /** Goes to the lobby. Without it "Join" does what "Open" does. */
  onJoinRoom?: (room: Room) => void;
};

const COLUMNS = { '--cols': 'minmax(0, 1.8fr) minmax(0, 1.3fr) 96px 148px' } as React.CSSProperties;
const SKELETON_COLUMNS = { '--cols': 'minmax(0, 1.6fr) minmax(0, 1fr) 72px 64px' } as React.CSSProperties;

export const RoomAccessLabel: React.FC<{ access: Room['access']; className?: string }> = ({ access, className = '' }) => {
  const Icon = access === RoomAccess.PASSWORD ? Lock : access === RoomAccess.MEMBERS ? Users : Globe;
  return (
    <div role="cell" className={`tbl__cell ${className}`}>
      <Icon className="icon" aria-hidden="true" />
      <span>
        {access === RoomAccess.OPEN ? <Trans>Public link</Trans> : access === RoomAccess.MEMBERS ? <Trans>Members only</Trans> : <Trans>Password protected</Trans>}
      </span>
    </div>
  );
};

export const LiveTag: React.FC<{ count: number; className?: string }> = ({ count, className = '' }) => (
  <Tag variant="live" className={className}><Trans>Live</Trans> <span className="fig">{count}</span></Tag>
);

export const EmptyRooms: React.FC<{ onOpenCreate: () => void }> = ({ onOpenCreate }) => (
  <div className="empty sheet">
    <p className="empty__title"><Trans>No rooms yet. Create one to get started.</Trans></p>
    <Button onClick={onOpenCreate}><Plus className="icon" aria-hidden="true" /><Trans>New Room</Trans></Button>
  </div>
);

const SkeletonRow: React.FC<{ nameWidth: string }> = ({ nameWidth }) => (
  <div className="tbl__row dash-skel-row dash-skel-fold">
    <div className="grid gap-1.5">
      <Skeleton className={`h-3 ${nameWidth}`} />
      <Skeleton className="h-2.5 w-2/5" />
    </div>
    <Skeleton className="h-3 w-[70%]" />
    <Skeleton className="h-5" />
    <Skeleton className="h-8 rounded-stock" />
  </div>
);

export const RoomsSkeleton: React.FC = () => (
  <div className="tbl" role="status" aria-label={t`Loading rooms`} style={SKELETON_COLUMNS}>
    <SkeletonRow nameWidth="w-3/5" />
    <SkeletonRow nameWidth="w-1/2" />
    <SkeletonRow nameWidth="w-[70%]" />
  </div>
);

export const RoomsTable: React.FC<RoomsTableProps> = ({ rooms, limit, shortOnPhone = false, notesAvailability, onViewNotes, onCopyLink, onEdit, onDelete, onOpenRoom, onJoinRoom = onOpenRoom }) => {
  const displayRooms = limit ? rooms.slice(0, limit) : rooms;

  return (
    <div className={`tbl dash-rooms ${shortOnPhone ? 'dash-rooms--short' : ''}`} role="table" aria-label={t`Rooms`} style={COLUMNS}>
      <div className="tbl__row tbl__row--head" role="row">
        <span role="columnheader"><Trans>Name</Trans></span>
        <span role="columnheader"><Trans>Access</Trans></span>
        <span role="columnheader"><Trans>Status</Trans></span>
        <span role="columnheader" className="text-right"><Trans>Action</Trans></span>
      </div>
      {displayRooms.map(room => {
        const isLive = room.activeParticipants > 0;
        return (
          <div key={room.id} className="tbl__row" role="row">
            <div role="cell" className="dash-rooms__who min-w-0">
              <p className="tbl__name">
                <button type="button" className="cursor-pointer text-left hover:underline" onClick={() => onOpenRoom(room)}>{room.name}</button>
              </p>
              <p className="tbl__sub">/{room.slug}</p>
            </div>
            <RoomAccessLabel access={room.access} className="dash-rooms__access" />
            <div role="cell" className="dash-rooms__status">
              {isLive ? <LiveTag count={room.activeParticipants} /> : <Tag variant="quiet"><Trans>Offline</Trans></Tag>}
            </div>
            <div role="cell" className="tbl__actions">
              <RoomMenu
                room={room}
                hasNotes={!!notesAvailability?.[room.id]}
                onViewNotes={onViewNotes}
                onCopyLink={onCopyLink}
                onEdit={onEdit}
                onDelete={onDelete}
              />
              {isLive
                ? <Button size="sm" onClick={() => onJoinRoom(room)}><Trans>Join</Trans></Button>
                : <Button variant="secondary" size="sm" onClick={() => onOpenRoom(room)}><Trans>Open</Trans></Button>}
            </div>
          </div>
        );
      })}
    </div>
  );
};
