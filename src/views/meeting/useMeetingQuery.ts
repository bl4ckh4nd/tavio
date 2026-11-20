import type { FunctionReference } from 'convex/server';
import { useQueryResult } from '../../hooks/useQueryResult';
import { isRoomAccessError } from './MeetingAccessBoundary';

// A failed query must not end a running call, so it comes back as an Error for its region to report.
// Revoked access still throws: MeetingAccessBoundary ends the meeting on purpose.
export const useMeetingQuery = <Query extends FunctionReference<'query'>>(query: Query, args: Query['_args'] | 'skip') => {
  const result = useQueryResult(query, args);
  if (isRoomAccessError(result)) throw result;
  return result;
};
