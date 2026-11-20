import { useMemo } from 'react';
import { useQueries } from 'convex/react';
import { getFunctionName, type FunctionReference } from 'convex/server';

// useQuery throws a failed query into the render, which replaces the whole page.
// This returns the Error instead, so one region can report its own failure.
export const useQueryResult = <Query extends FunctionReference<'query'>>(
  query: Query,
  args: Query['_args'] | 'skip',
): Query['_returnType'] | undefined | Error => {
  // useQueries resubscribes when its input changes, and every read of api.x.y is a new object, so compare by name.
  const name = getFunctionName(query);
  const key = JSON.stringify(args);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const queries = useMemo((): Record<string, { query: Query; args: Query['_args'] }> => (args === 'skip' ? {} : { result: { query, args } }), [name, key]);
  return useQueries(queries).result;
};

// For a region that reads a failed query the same as one still loading.
export const withoutError = <T,>(result: T | Error): T | undefined => (result instanceof Error ? undefined : result);
