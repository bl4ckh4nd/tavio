import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '../../../convex/_generated/api';
import type { WhiteboardElement } from '../../types';
import { boardSignature } from '../../components/whiteboard/operations';

// What this board changed and the server has not confirmed yet.
type Outbox = {
  elements: Map<string, WhiteboardElement>;
  addedIds: Set<string>;
  removedIds: Set<string>;
  order?: string[];
  generation?: number;
};

const emptyOutbox = (): Outbox => ({ elements: new Map(), addedIds: new Set(), removedIds: new Set() });

// Folds `newer` into `older`; the newer change of an element wins. Changes to a board that has
// since left the wall are dropped, as the server would drop them, not relabelled for the new one.
const merge = (older: Outbox, newer: Outbox): Outbox => {
  if (older.generation !== undefined && newer.generation !== undefined && older.generation !== newer.generation) return newer;
  const elements = new Map([...older.elements, ...newer.elements]);
  const addedIds = new Set([...older.addedIds, ...newer.addedIds]);
  const removedIds = new Set(older.removedIds);
  for (const id of newer.removedIds) {
    elements.delete(id);
    // An element removed before the server ever saw it needs neither an add nor a remove.
    if (addedIds.delete(id)) continue;
    removedIds.add(id);
  }
  for (const id of newer.addedIds) removedIds.delete(id);
  return {
    elements,
    addedIds,
    removedIds,
    order: newer.order ?? older.order,
    generation: newer.generation ?? older.generation,
  };
};

const isEmpty = (box: Outbox) => !box.elements.size && !box.addedIds.size && !box.removedIds.size && !box.order;

// A save the server rejected on its merits fails the same way every time; anything else
// (connection, rate limit) is worth sending again.
const isPermanent = (error: unknown) =>
  error instanceof ConvexError && (error.data as { kind?: string } | undefined)?.kind !== 'RateLimited';

const RETRY_MS = [1000, 2000, 5000, 10000];

export const useWhiteboardSync = (roomId: string | undefined, roomAccessToken: string | undefined) => {
  const saveWhiteboard = useMutation(api.whiteboard.save);
  const [whiteboardError, setWhiteboardError] = useState<string | null>(null);
  const outbox = useRef(emptyOutbox());
  const sending = useRef(false);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Boards waiting to hear that nothing of theirs is unsaved any more.
  const waiting = useRef<Array<() => void>>([]);

  // Saved, or refused for good: either way nothing of this board is on its way.
  const settleIfIdle = () => {
    if (sending.current || retryTimer.current || !isEmpty(outbox.current)) return;
    const done = waiting.current;
    waiting.current = [];
    done.forEach(resolve => resolve());
  };
  const saved = () => new Promise<void>(resolve => {
    waiting.current.push(resolve);
    settleIfIdle();
  });

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  const flush = useCallback(async () => {
    if (!roomId || sending.current || isEmpty(outbox.current)) return;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    const sent = outbox.current;
    outbox.current = emptyOutbox();
    sending.current = true;
    try {
      await saveWhiteboard({
        roomId,
        accessToken: roomAccessToken,
        generation: sent.generation,
        elements: [...sent.elements.values()],
        edit: { removedIds: [...sent.removedIds], addedIds: [...sent.addedIds], order: sent.order },
      });
      failures.current = 0;
      if (isEmpty(outbox.current)) setWhiteboardError(null);
    } catch (error) {
      setWhiteboardError(t`Unable to sync whiteboard.`);
      if (!isPermanent(error)) {
        outbox.current = merge(sent, outbox.current);
        const delay = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)];
        failures.current += 1;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void flush();
        }, delay);
      }
    } finally {
      sending.current = false;
    }
    // Changes made while this save was in flight go out now, unless a retry is waiting.
    if (!retryTimer.current) void flush();
    settleIfIdle();
  }, [roomId, roomAccessToken, saveWhiteboard]);

  const handleWhiteboardCommit = useCallback((
    next: WhiteboardElement[],
    previous: WhiteboardElement[],
    generation?: number,
  ): Promise<void> => {
    if (!roomId) return Promise.resolve();
    const before = new Map(previous.map(el => [el.id, el]));
    const after = new Set(next.map(el => el.id));
    const removedIds = previous.filter(el => !after.has(el.id)).map(el => el.id);
    const addedIds = next.filter(el => !before.has(el.id)).map(el => el.id);
    const elements = next.filter(el => {
      const prior = before.get(el.id);
      return !prior || (prior !== el && boardSignature([prior]) !== boardSignature([el]));
    });
    const appended = [...previous.filter(el => after.has(el.id)).map(el => el.id), ...addedIds];
    const order = next.some((el, i) => el.id !== appended[i]) ? next.map(el => el.id) : undefined;
    if (!elements.length && !removedIds.length && !order) return saved();

    outbox.current = merge(outbox.current, {
      elements: new Map(elements.map(el => [el.id, el])),
      addedIds: new Set(addedIds),
      removedIds: new Set(removedIds),
      order,
      generation,
    });
    if (!retryTimer.current) void flush();
    return saved();
  }, [roomId, flush]);

  return { whiteboardError, handleWhiteboardCommit };
};
