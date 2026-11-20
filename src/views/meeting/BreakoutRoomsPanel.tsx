import React from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { usePeople } from './assistant/assistantParticipant';
import { BreakoutRooms } from '../../components/BreakoutRooms';
import { BreakoutRoom, User, UserRole } from '../../types';

export interface BreakoutRoomsPanelProps {
  breakoutRooms: BreakoutRoom[];
  isBreakoutActive: boolean;
  currentBreakoutRoomId: string | null;
  currentUser: User;
  participantNames?: Record<string, string>;
  darkMode?: boolean;
  onStartSession: (rooms: BreakoutRoom[]) => void;
  onEndSession: () => Promise<boolean>;
  onJoinRoom: (roomId: string | null) => void;
}

export const BreakoutRoomsPanel: React.FC<BreakoutRoomsPanelProps> = ({
  breakoutRooms,
  isBreakoutActive,
  currentBreakoutRoomId,
  currentUser,
  participantNames = {},
  onStartSession,
  onEndSession,
  onJoinRoom,
}) => {
  const remoteParticipants = usePeople();
  const { localParticipant } = useLocalParticipant();

  const visibleParticipants = [localParticipant, ...remoteParticipants].filter(Boolean)
  const assignedIdentities = breakoutRooms.flatMap(room => room.participantIds)
  const hiddenAssignedParticipants = assignedIdentities
    .filter(identity => !visibleParticipants.some(participant => participant!.identity === identity))
    .map(identity => ({ identity, name: participantNames[identity] || identity }))
  const participants: User[] = [...visibleParticipants, ...hiddenAssignedParticipants]
    .filter(Boolean)
    .map((p) => ({
      id: p!.identity,
      name: p!.name || participantNames[p!.identity] || p!.identity,
      role: p!.identity === localParticipant?.identity
        ? currentUser.role
        : ((p as any).attributes?.role === UserRole.HOST || (p as any).attributes?.role === UserRole.ADMIN)
          ? (p as any).attributes.role
          : UserRole.PARTICIPANT,
      isMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
      isHandRaised: false,
      breakoutRoomId: breakoutRooms.find(room => room.participantIds.includes(p!.identity))?.id ?? null,
    }));

  return (
    <BreakoutRooms
      isOpen
      onClose={() => {}}
      participants={participants}
      rooms={breakoutRooms}
      isActive={isBreakoutActive}
      onStartSession={onStartSession}
      onEndSession={onEndSession}
      onJoinRoom={onJoinRoom}
      currentRoomId={currentBreakoutRoomId}
      canManage={currentUser.role === UserRole.HOST || currentUser.role === UserRole.ADMIN}
    />
  );
};
