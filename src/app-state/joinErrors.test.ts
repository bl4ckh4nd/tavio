import { describe, expect, it } from 'vitest';
import { ConvexError } from 'convex/values';
import { normalizeJoinError } from './joinErrors';

describe('normalizeJoinError', () => {
  it('maps known backend errors to user-safe messages', () => {
    expect(normalizeJoinError(new Error('Invalid room password'))).toMatch(/Incorrect room password/);
    expect(normalizeJoinError(new Error('Password required'))).toMatch(/password-protected/);
    expect(normalizeJoinError(new Error('Room not found'))).toMatch(/Room not found/);
    expect(normalizeJoinError(new Error('A host or member must be present'))).toMatch(/not started yet/);
    expect(normalizeJoinError(new Error('This meeting has ended. A host can reopen the room.'))).toMatch(/meeting has ended/);
    expect(normalizeJoinError(new Error('Forbidden'))).toMatch(/do not have access/);
  });

  it('reads the message of ConvexErrors, which survive production redaction', () => {
    expect(normalizeJoinError(new ConvexError('Invalid room password'))).toMatch(/Incorrect room password/);
  });

  it('falls back to generic message for unknown errors', () => {
    expect(normalizeJoinError(new Error('something unexpected'))).toBe('Could not join room. Please try again.');
    expect(normalizeJoinError('random string')).toBe('Could not join room. Please try again.');
  });
});
