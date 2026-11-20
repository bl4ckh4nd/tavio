import { AppView, Room } from '../../types';

export interface AdminProps {
  onNavigate: (view: AppView, param?: string) => void;
  rooms: Room[];
  onCreateRoom: (room: Room) => Promise<void>;
  onUpdateRoom: (room: Room) => Promise<void>;
  onDeleteRoom: (roomId: string) => Promise<void>;
  /** Set on the room page and on a session's page; both live under the Rooms tab. */
  roomSlug?: string;
  sessionId?: string;
  initialTab?: AdminTab;
  onOpenRoomPage?: (slug: string) => void;
  onOpenSession?: (slug: string, sessionId: string) => void;
  /** Leaves the room page for one of the dashboard's tabs. */
  onLeaveRoomPage?: (tab: AdminTab) => void;
}

export type AdminTab = 'OVERVIEW' | 'ROOMS' | 'RECORDINGS' | 'SETTINGS';
export type SettingsTab = 'PROFILE' | 'TEAM' | 'BILLING' | 'API';

export type NotesDoc = {
  contentHtml: string;
} | null | undefined;
