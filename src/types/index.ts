
export enum AppView {
  LANDING = 'LANDING',
  LOBBY = 'LOBBY',
  MEETING = 'MEETING',
  ADMIN = 'ADMIN',
  DOCS = 'DOCS',
  AUTH = 'AUTH',
  PASSWORD_RESET = 'PASSWORD_RESET',
  ONBOARDING = 'ONBOARDING',
}

export enum UserRole {
  HOST = 'Host',
  PARTICIPANT = 'Participant',
  ADMIN = 'Admin'
}

export enum RoomType {
  WORKSPACE = 'WORKSPACE',
  PERSONAL = 'PERSONAL',
  HANGOUT = 'HANGOUT'
}

export enum RoomAccess {
  OPEN = 'OPEN',
  MEMBERS = 'MEMBERS',
  PASSWORD = 'PASSWORD'
}

export interface RoomBranding {
  logoUrl?: string;
  logoStorageId?: string;
  logoSource?: 'manual_upload' | 'manual_url' | 'auto_discovered';
  logoFetchStatus?: 'idle' | 'pending' | 'success' | 'failed';
  logoFetchError?: string;
  logoFetchedAt?: string;
  partnerWebsiteUrl?: string;
  primaryColor?: string;
  backgroundImageUrl?: string;
  backgroundStorageId?: string;
  theme?: 'light' | 'dark';
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
  role: UserRole;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isHandRaised: boolean;
  breakoutRoomId?: string | null;
}

export interface BreakoutRoom {
  id: string;
  name: string;
  participantIds: string[];
}

export type BreakoutMode = 'native' | 'reconnect';

export interface BreakoutSessionRoom {
  id: string;
  name: string;
  livekitRoomName: string;
}

export interface BreakoutAssignment {
  identity: string;
  name: string;
  roomId: string;
}

export interface BreakoutSession {
  id: string;
  parentRoomId: string;
  generation: number;
  status: 'active' | 'ended';
  rooms: BreakoutSessionRoom[];
  assignments: BreakoutAssignment[];
  createdAt: number;
  endedAt?: number;
}

export interface Room {
  id: string;
  slug: string;
  name: string;
  type: RoomType;
  access: RoomAccess;
  password?: string;
  activeParticipants: number;
  maxParticipants: number;
  locked: boolean;
  recording: boolean;
  createdAt: string;
  branding?: RoomBranding;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
}

export interface DeviceConfig {
  audioInput: string;
  audioOutput: string;
  videoInput: string;
}

// Chart Data Types
export interface ActivityData {
  name: string;
  participants: number;
  rooms: number;
}

export interface MeetingDocRecord {
  roomId: string;
  contentHtml: string;
  locked: boolean;
}

export type WhiteboardPoint = { x: number; y: number };
export type WhiteboardStrokeStyle = 'solid' | 'dashed' | 'dotted';
export type WhiteboardFillStyle = 'solid' | 'hachure' | 'cross-hatch';
/** What every element can carry. All optional, so boards saved before they existed stay valid. */
type WhiteboardCommon = {
  id: string;
  /** 0.05 to 1; missing means fully opaque. */
  opacity?: number;
  /** Elements with the same group id are selected, moved and aligned together. */
  groupId?: string;
  /** Not selectable or erasable on the board until unlocked. */
  locked?: boolean;
};
export type WhiteboardStroke = WhiteboardCommon & {
  type: 'stroke';
  /** "eraser" strokes are only drawn for old boards; the eraser now removes whole elements. A marker is wide and see-through. */
  tool: 'pen' | 'eraser' | 'marker';
  color: string;
  size: number;
  points: WhiteboardPoint[];
};
export type WhiteboardImage = WhiteboardCommon & {
  type: 'image';
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
/** The shapes from the "more shapes" menu; each is outlined by one path, the same on the board and in a file. */
export const WHITEBOARD_MORE_SHAPES = ['speech', 'cylinder', 'hexagon', 'star', 'parallelogram', 'block-arrow', 'triangle', 'cloud'] as const;
export type WhiteboardMoreShape = typeof WHITEBOARD_MORE_SHAPES[number];
/** A note is a square sticky; a section is a named area that carries what lies on it; a mind map node hangs off its parent. */
export type WhiteboardShapeType = 'rectangle' | 'circle' | 'diamond' | 'note' | 'section' | 'task' | 'table' | 'mindmap' | WhiteboardMoreShape;
export type WhiteboardShape = WhiteboardCommon & {
  type: 'shape';
  shapeType: WhiteboardShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  strokeStyle?: WhiteboardStrokeStyle;
  fillStyle?: WhiteboardFillStyle;
  roundness?: 'sharp' | 'round';
  /** Written inside the shape: a note on the board. A section's name. */
  text?: string;
  /** How the text inside a shape, a table or a mind map node is set. */
  fontSize?: number;
  textAlign?: 'left' | 'center' | 'right';
  /** A table's cells, row by row; the first row is its head. Every row has the same number of cells. */
  cells?: string[][];
  /** A mind map node's parent node; the root has none. */
  parent?: string;
  /** Put there by the meeting assistant. */
  author?: 'assistant';
  /** The name of the person who wrote a note, shown under it. */
  by?: string;
  /** A task card: ticked off, who does it, and by when (YYYY-MM-DD). */
  done?: boolean;
  owner?: string;
  due?: string;
};
/** Where an arrow end sits on another element: a fraction of that element's box, so it follows when the box moves. */
export type WhiteboardBinding = { id: string; fx: number; fy: number };
export type WhiteboardLine = WhiteboardCommon & {
  type: 'line';
  /** Two or more; drawn straight from one to the next. */
  points: WhiteboardPoint[];
  strokeColor: string;
  strokeWidth: number;
  strokeStyle?: WhiteboardStrokeStyle;
  startArrow?: boolean;
  endArrow?: boolean;
  start?: WhiteboardBinding;
  end?: WhiteboardBinding;
  /** Runs at right angles out of the sides its ends sit on, instead of straight between its points. */
  elbow?: boolean;
  /** Written on the middle of the line. */
  label?: string;
};
export type WhiteboardText = WhiteboardCommon & {
  type: 'text';
  x: number;
  y: number;
  /** Measured when the text was written, so the server and the thumbnails know its box. */
  width: number;
  height: number;
  text: string;
  color: string;
  fontSize: number;
  textAlign?: 'left' | 'center' | 'right';
};
export const WHITEBOARD_STAMPS = ['thumb', 'heart', 'star', 'check', 'question', 'plus1', 'spark', 'no', 'tape'] as const;
export type WhiteboardStampKind = typeof WHITEBOARD_STAMPS[number];
/** A reaction stuck on an element; it stays where it was put on it, and goes with it. */
export type WhiteboardStamp = WhiteboardCommon & {
  type: 'stamp';
  stamp: WhiteboardStampKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Who put it there. */
  by?: string;
  /** The element it sits on; its centre is kept at this point of that element's box. */
  on?: WhiteboardBinding;
};
/** A page of HTML shown on the board as it would be in a browser, without scripts or anything loaded from elsewhere. */
export type WhiteboardHtml = WhiteboardCommon & {
  type: 'html';
  /** The stored page; boards only carry its name. */
  page: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type WhiteboardElement = WhiteboardStroke | WhiteboardImage | WhiteboardShape | WhiteboardLine | WhiteboardText | WhiteboardStamp | WhiteboardHtml;

export type MeetingEndReason = 'left' | 'host_ended';

export interface MeetingSummary {
  roomName: string;
  roomSlug?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  participantNames: string[];
  chatMessageCount: number;
  hadNotes: boolean;
  hadRecording: boolean;
  reason: MeetingEndReason;
  /** The session this meeting belonged to, if the room counted it as one (two people, or a recording). */
  sessionId?: string;
  sessionStartedAt?: number;
  /** The whiteboard was drawn on during the session, so its state goes into the record. */
  hadBoard?: boolean;
  /** Only people who belong to the room can open its history. */
  canOpenHistory?: boolean;
  /** Task cards on the board when the call ended, open ones first. */
  tasks?: { text: string; owner?: string; due?: string; done: boolean }[];
}

/** Turn a room name or typed room reference into a slug: "Design Sync Räume" -> "design-sync-raume". */
export const toRoomSlug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50)
    .replace(/^-+|-+$/g, '');
