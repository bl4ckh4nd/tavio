import { RoomAccess, RoomType, UserRole, type Room, type User } from '../../src/types';

export const makeRoom = (overrides: Partial<Room> = {}): Room => ({
  id: 'room-1',
  name: 'Daily Standup',
  slug: 'daily-standup',
  type: RoomType.WORKSPACE,
  access: RoomAccess.OPEN,
  activeParticipants: 0,
  maxParticipants: 50,
  locked: false,
  recording: false,
  createdAt: '2026-02-13',
  ...overrides,
});

export const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  name: 'Test User',
  role: UserRole.PARTICIPANT,
  isMuted: false,
  isCameraOff: false,
  isScreenSharing: false,
  isHandRaised: false,
  ...overrides,
});
