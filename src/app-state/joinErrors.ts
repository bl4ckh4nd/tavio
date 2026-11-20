import { t } from '@lingui/core/macro';
import { ConvexError } from 'convex/values';

export const normalizeJoinError = (err: unknown): string => {
  const raw =
    typeof err === 'string'
      ? err
      : err instanceof ConvexError && typeof err.data === 'string'
        ? err.data
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : '';
  const message = raw.toLowerCase();

  if (message.includes('invalid room password')) {
    return t`Incorrect room password. Please try again.`;
  }
  if (message.includes('password required')) {
    return t`This room is password-protected. Please enter the password to join.`;
  }
  if (message.includes('room not found')) {
    return t`Room not found. Check the room link and try again.`;
  }
  if (message.includes('host or member must be present')) {
    return t`This room has not started yet. Please wait for a host or member to join first.`;
  }
  if (message.includes('meeting has ended')) {
    return t`This meeting has ended. Only a host can reopen the room right now.`;
  }
  if (
    message.includes('not allowed') ||
    message.includes('not authorized') ||
    message.includes('forbidden')
  ) {
    return t`You do not have access to join this room.`;
  }
  return t`Could not join room. Please try again.`;
};
