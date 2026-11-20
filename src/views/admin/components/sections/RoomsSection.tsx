import React from 'react';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Search } from 'lucide-react';
import { Room } from '../../../../types';
import { Button, Input } from '../../../../components/ui';
import { AdminHeader } from '../AdminHeader';
import { LoadFailure } from '../RecordingsSection';
import { EmptyRooms, RoomsSkeleton, RoomsTable } from '../RoomsTable';

type RoomsSectionProps = {
  roomsSearchInput: string;
  onRoomsSearchChange: (value: string) => void;
  onOpenCreate: () => void;
  filteredRooms: Room[];
  roomsLoading?: boolean;
  roomsFailed?: boolean;
  roomsSearchTerm: string;
  notesAvailability?: Record<string, boolean>;
  onViewNotes: (room: Room) => void;
  onCopyLink: (room: Room) => void;
  onEditRoom: (room: Room) => void;
  onDeleteRoom: (room: Room) => void;
  onOpenRoom: (room: Room) => void;
  onJoinRoom?: (room: Room) => void;
};

export const RoomsSection: React.FC<RoomsSectionProps> = ({
  roomsSearchInput,
  onRoomsSearchChange,
  onOpenCreate,
  filteredRooms,
  roomsLoading = false,
  roomsFailed = false,
  roomsSearchTerm,
  notesAvailability,
  onViewNotes,
  onCopyLink,
  onEditRoom,
  onDeleteRoom,
  onOpenRoom,
  onJoinRoom = onOpenRoom,
}) => {
  const { _ } = useLingui();
  const searchLabel = _(msg`Search by name or slug...`);
  return <div>
    <AdminHeader
      title={<><span className="sm:hidden"><Trans>Rooms</Trans></span><span className="max-sm:hidden"><Trans>Meeting Rooms</Trans></span></>}
      description={<Trans>Manage the rooms and settings that keep your meetings moving.</Trans>}
    >
      <div className="dash-search">
        <Input
          aria-label={searchLabel}
          placeholder={searchLabel}
          className="!pl-9"
          leftIcon={<Search className="icon" aria-hidden="true" />}
          value={roomsSearchInput}
          onChange={e => onRoomsSearchChange(e.target.value)}
        />
      </div>
    </AdminHeader>
    {roomsFailed ? (
      <LoadFailure><Trans>Rooms could not be loaded</Trans></LoadFailure>
    ) : roomsLoading ? (
      <RoomsSkeleton />
    ) : roomsSearchTerm && filteredRooms.length === 0 ? (
      <div className="empty sheet">
        <p className="empty__title"><Trans>No rooms match your search.</Trans></p>
        <Button variant="secondary" onClick={() => onRoomsSearchChange('')}><Trans>Clear search</Trans></Button>
      </div>
    ) : filteredRooms.length === 0 ? (
      <EmptyRooms onOpenCreate={onOpenCreate} />
    ) : (
      <RoomsTable
        rooms={filteredRooms}
        notesAvailability={notesAvailability}
        onViewNotes={onViewNotes}
        onCopyLink={onCopyLink}
        onEdit={onEditRoom}
        onDelete={onDeleteRoom}
        onOpenRoom={onOpenRoom}
                onJoinRoom={onJoinRoom}
      />
    )}
  </div>;
};
