import { createContext } from 'react';

/**
 * The room a meeting takes place in. What belongs to the room rather than to the call
 * (boards, sessions, the notes' date line) reads it from here instead of through props.
 * Without it (no room yet, simulated meeting) those pieces work on their own.
 */
export type MeetingRoom = { roomId: string; accessToken?: string; roomSlug?: string };

export const MeetingRoomContext = createContext<MeetingRoom | null>(null);
