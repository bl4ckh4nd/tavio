
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { ArrowRight } from 'lucide-react';
import { Avatar, Button, Modal, Select, Tag } from './ui';
import { User, BreakoutRoom } from '../types';

interface BreakoutRoomsProps {
  isOpen: boolean;
  onClose: () => void;
  participants: User[];
  rooms: BreakoutRoom[];
  isActive: boolean;
  darkMode?: boolean;
  onStartSession: (rooms: BreakoutRoom[]) => void;
  onEndSession: () => Promise<boolean>;
  onJoinRoom: (roomId: string | null) => void;
  currentRoomId?: string | null;
  canManage?: boolean;
}

// Per-zone enter counter fixes the dragLeave-on-child false-fire bug
function useDropZone(zoneId: string, activeZone: string | null, setActiveZone: (z: string | null) => void) {
  const counter = useRef(0);
  const activeZoneRef = useRef(activeZone);
  activeZoneRef.current = activeZone;

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counter.current += 1;
    if (counter.current === 1) setActiveZone(zoneId);
  }, [zoneId, setActiveZone]);

  const onDragLeave = useCallback(() => {
    counter.current -= 1;
    if (counter.current <= 0) {
      counter.current = 0;
      if (activeZoneRef.current === zoneId) setActiveZone(null);
    }
  }, [zoneId, setActiveZone]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const isOver = activeZone === zoneId;
  return { onDragEnter, onDragLeave, onDragOver, isOver };
}

export const BreakoutRooms: React.FC<BreakoutRoomsProps> = ({
  isOpen,
  participants,
  rooms: activeRooms,
  isActive,
  onStartSession,
  onEndSession,
  onJoinRoom,
  currentRoomId,
  canManage,
}) => {
  const [roomCount, setRoomCount] = useState(2);
  const [draftRooms, setDraftRooms] = useState<BreakoutRoom[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);

  useEffect(() => {
    if (isOpen && !isActive && draftRooms.length === 0) generateDraftRooms(roomCount);
  }, [isOpen, isActive]);

  const generateDraftRooms = (count: number) => {
    const newRooms: BreakoutRoom[] = Array.from({ length: count }, (_, i) => ({
      id: `room-${Date.now()}-${i}`,
      name: `${t`Room`} ${i + 1}`,
      participantIds: [],
    }));
    const nonHosts = participants.filter(p => p.role !== 'Host' && p.role !== 'Admin');
    nonHosts.forEach((user, i) => newRooms[i % count].participantIds.push(user.id));
    setDraftRooms(newRooms);
  };

  const handleRoomCountChange = (delta: number) => {
    const newCount = Math.max(2, Math.min(10, roomCount + delta));
    setRoomCount(newCount);
    generateDraftRooms(newCount);
  };

  const handleDragStart = (e: React.DragEvent, user: User) => {
    e.dataTransfer.setData('userId', user.id);
    e.dataTransfer.effectAllowed = 'move';

    // Custom drag chip
    const ghost = document.createElement('div');
    ghost.className = 'bo__ghost';
    // Participant names are user-chosen: build text nodes, never HTML.
    ghost.textContent = user.name;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 16, 16);
    requestAnimationFrame(() => document.body.removeChild(ghost));
    setDraggingId(user.id);
  };

  const handleDragEnd = () => { setDraggingId(null); setActiveZone(null); };

  const handleDrop = (e: React.DragEvent, targetZone: string | 'unassigned') => {
    e.preventDefault();
    const userId = e.dataTransfer.getData('userId');
    if (!userId) return;
    setActiveZone(null);
    setDraggingId(null);
    setDraftRooms(prev => {
      const next = prev.map(r => ({ ...r, participantIds: r.participantIds.filter(id => id !== userId) }));
      if (targetZone !== 'unassigned') {
        const idx = next.findIndex(r => r.id === targetZone);
        if (idx !== -1 && !next[idx].participantIds.includes(userId)) next[idx].participantIds.push(userId);
      }
      return next;
    });
  };

  const handleAssign = (userId: string, targetZone: string | 'unassigned') => {
    setDraftRooms(prev => {
      const next = prev.map(r => ({ ...r, participantIds: r.participantIds.filter(id => id !== userId) }));
      if (targetZone !== 'unassigned') {
        const target = next.find(r => r.id === targetZone);
        if (target && !target.participantIds.includes(userId)) target.participantIds.push(userId);
      }
      return next;
    });
  };

  const unassigned = participants.filter(
    p => p.role !== 'Host' && p.role !== 'Admin' && !draftRooms.some(r => r.participantIds.includes(p.id))
  );

  const isDragging = draggingId !== null;

  const handleEndSession = async () => {
    if (isEndingSession) return;
    setIsEndingSession(true);
    try {
      const ended = await onEndSession();
      if (ended) setShowEndConfirmation(false);
    } finally {
      setIsEndingSession(false);
    }
  };

  if (!isOpen) return null;

  if (!isActive && !canManage) {
    return (
      <div className="panel h-full flex-1">
        <div className="panel__body mquiet text-sm text-muted">
          <Trans>The host has not started breakout rooms yet.</Trans>
        </div>
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="panel h-full flex-1">
        <div className="panel__body bo">
          {/* Unassigned pool */}
          <UnassignedZone
            users={unassigned}
            participants={participants}
            draggingId={draggingId}
            activeZone={activeZone}
            setActiveZone={setActiveZone}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            onAssign={handleAssign}
            availableRooms={draftRooms}
          />

          {/* Draft rooms */}
          {draftRooms.map(room => (
            <RoomZone
              key={room.id}
              room={room}
              participants={participants}
              draggingId={draggingId}
              activeZone={activeZone}
              setActiveZone={setActiveZone}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              onAssign={handleAssign}
              availableRooms={draftRooms}
              isDragging={isDragging}
            />
          ))}

          {/* Controls */}
          <div className="bo__zone">
            <p className="bo__head"><span><Trans>Rooms</Trans></span><span className="fig">{roomCount}</span></p>
            <div className="bo__actions">
              <Button type="button" variant="secondary" size="sm" onClick={() => handleRoomCountChange(1)}><Trans>Add room</Trans></Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => handleRoomCountChange(-1)}><Trans>Remove room</Trans></Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => generateDraftRooms(roomCount)}><Trans>Redistribute</Trans></Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setDraftRooms(prev => prev.map(r => ({ ...r, participantIds: [] })))}><Trans>Clear</Trans></Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="panel__foot">
          <span className="shrink-0 text-xs text-muted">
            {unassigned.length > 0 ? t`${unassigned.length} unassigned` : t`All assigned`}
          </span>
          <Button type="button" className="flex-1" onClick={() => onStartSession(draftRooms)}>
            <Trans>Start</Trans>
          </Button>
        </div>
      </div>
    );
  }

  // ── ACTIVE MODE ──
  return (
    <>
    <div className="panel h-full flex-1">
      <div className="panel__body bo">
        {/* Status */}
        <div className="grid justify-items-start gap-1">
          <Tag><Trans>Session active</Trans></Tag>
          <p className="bo__note">
            <Trans>Recording covers the main room only during breakout sessions.</Trans>
          </p>
        </div>

        {/* Main room */}
        <section className={`bo__card sheet ${currentRoomId === null ? 'is-on' : ''}`}>
          <div className="bo__cardhead">
            <span><Trans>Main Room</Trans></span>
            {currentRoomId === null
              ? <Tag><Trans>Here</Trans></Tag>
              : <Button type="button" variant="secondary" size="sm" onClick={() => onJoinRoom(null)}><Trans>Return</Trans></Button>
            }
          </div>
          {participants.filter(p => !p.breakoutRoomId).map(p => (
            <div key={p.id} className="row">
              <Avatar name={p.name} size="sm" />
              <span className="row__main">{p.name}</span>
            </div>
          ))}
        </section>

        {/* Breakout rooms */}
        {activeRooms.map(room => {
          const isCurrent = currentRoomId === room.id;
          const roomParticipants = participants.filter(p => p.breakoutRoomId === room.id);
          return (
            <section key={room.id} className={`bo__card sheet ${isCurrent ? 'is-on' : ''}`}>
              <div className="bo__cardhead">
                <span className="min-w-0 truncate">{room.name}</span>
                {isCurrent
                  ? <Tag><Trans>Here</Trans></Tag>
                  : <Button type="button" variant="secondary" size="sm" onClick={() => onJoinRoom(room.id)}>
                      <Trans>Join</Trans><ArrowRight className="icon" aria-hidden="true" />
                    </Button>
                }
              </div>
              {roomParticipants.map(p => (
                <div key={p.id} className="row">
                  <Avatar name={p.name} size="sm" />
                  <span className="row__main">{p.name}</span>
                </div>
              ))}
              {roomParticipants.length === 0 && (
                <p className="bo__empty"><Trans>Empty</Trans></p>
              )}
            </section>
          );
        })}
      </div>

      {/* Footer */}
      {canManage && (
        <div className="panel__foot">
          <Button type="button" variant="secondary" className="btn--wide" onClick={() => setShowEndConfirmation(true)}>
            <Trans>End Session</Trans>
          </Button>
        </div>
      )}
    </div>
    <Modal
      isOpen={showEndConfirmation}
      onClose={() => { if (!isEndingSession) setShowEndConfirmation(false); }}
      ariaLabel={t`End breakout session`}
      closeOnBackdrop={!isEndingSession}
    >
      <div className="dialog w-full">
        <h2 className="dialog__title"><Trans>End breakout session?</Trans></h2>
        <p className="text-sm text-ink-2">
          <Trans>Everyone in a breakout room will return to the main meeting.</Trans>
        </p>
        <div className="dialog__actions">
          <Button type="button" variant="secondary" onClick={() => setShowEndConfirmation(false)} disabled={isEndingSession}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="button" variant="danger" onClick={() => void handleEndSession()} isLoading={isEndingSession}>
            <Trans>End session</Trans>
          </Button>
        </div>
      </div>
    </Modal>
    </>
  );
};

// ── Drop zones ──

interface ZoneSharedProps {
  participants: User[];
  draggingId: string | null;
  activeZone: string | null;
  setActiveZone: (z: string | null) => void;
  onDragStart: (e: React.DragEvent, user: User) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, zone: string | 'unassigned') => void;
  onAssign?: (userId: string, zone: string | 'unassigned') => void;
  availableRooms?: BreakoutRoom[];
}

const UnassignedZone: React.FC<ZoneSharedProps & { users: User[] }> = ({
  users, draggingId, activeZone, setActiveZone, onDragStart, onDragEnd, onDrop, onAssign, availableRooms = [],
}) => {
  const { onDragEnter, onDragLeave, onDragOver, isOver } = useDropZone('unassigned', activeZone, setActiveZone);

  if (users.length === 0 && !activeZone) return null;

  return (
    <section className="bo__zone">
      <p className="bo__head">
        <span><Trans>Unassigned</Trans></span>
        <span className="fig">{users.length}</span>
      </p>
      <div
        className={`bo__well ${isOver ? 'is-over' : ''}`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={e => onDrop(e, 'unassigned')}
      >
        {users.map(p => (
          <ParticipantChip key={p.id} user={p} roomId="unassigned" availableRooms={availableRooms} onAssign={onAssign} isDragging={draggingId === p.id} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        ))}
        {users.length === 0 && isOver && (
          <span className="bo__hint">
            <Trans>Release to unassign</Trans>
          </span>
        )}
      </div>
    </section>
  );
};

interface RoomZoneProps extends ZoneSharedProps {
  room: BreakoutRoom;
  isDragging: boolean;
}

const RoomZone: React.FC<RoomZoneProps> = ({
  room, participants, draggingId, activeZone, setActiveZone, onDragStart, onDragEnd, onDrop, onAssign, availableRooms = [], isDragging,
}) => {
  const { onDragEnter, onDragLeave, onDragOver, isOver } = useDropZone(room.id, activeZone, setActiveZone);
  const roomParticipants = room.participantIds.map(id => participants.find(u => u.id === id)).filter(Boolean) as User[];

  return (
    <section className="bo__zone">
      <p className="bo__head">
        <span className="min-w-0 truncate">{room.name}</span>
        <span className="fig">{roomParticipants.length}</span>
      </p>
      <div
        className={`bo__well ${isOver ? 'is-over' : isDragging ? 'opacity-90' : ''}`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={e => onDrop(e, room.id)}
      >
        {roomParticipants.map(p => (
          <ParticipantChip key={p.id} user={p} roomId={room.id} availableRooms={availableRooms} onAssign={onAssign} isDragging={draggingId === p.id} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        ))}
        {roomParticipants.length === 0 && (
          <span className="bo__hint">
            {isOver ? <Trans>Drop here</Trans> : <Trans>Empty</Trans>}
          </span>
        )}
      </div>
    </section>
  );
};

// ── Chip ──

interface ChipProps {
  user: User;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, user: User) => void;
  onDragEnd: () => void;
  roomId?: string;
  availableRooms?: BreakoutRoom[];
  onAssign?: (userId: string, roomId: string | 'unassigned') => void;
}

const ParticipantChip: React.FC<ChipProps> = ({ user, isDragging, onDragStart, onDragEnd, roomId = 'unassigned', availableRooms = [], onAssign }) => (
  <div
    draggable
    onDragStart={e => onDragStart(e, user)}
    onDragEnd={onDragEnd}
    className={`bo__chip w-full py-1 md:w-auto md:py-0 ${isDragging ? 'is-dragging' : ''}`}
  >
    <span className="bo__chip-name">{user.name}</span>
    {onAssign && <div className="ml-auto w-44 max-w-[62%] shrink-0 md:pointer-fine:hidden">
      <Select
        value={roomId}
        aria-label={t`Assign ${user.name}`}
        onChange={event => onAssign(user.id, event.target.value === 'unassigned' ? 'unassigned' : event.target.value)}
      >
        <option value="unassigned">{t`Unassigned`}</option>
        {availableRooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
      </Select>
    </div>}
  </div>
);
