import React, { useState } from 'react';
import { t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { useMutation } from 'convex/react';
import { Vote } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { withoutError } from '../../../hooks/useQueryResult';
import { Button } from '../../../components/ui';
import { useToast } from '../../../components/ToastProvider';
import type { WhiteboardElement } from '../../../types';
import { elementWords } from '../../../components/whiteboard/operations';
import { useMeetingQuery } from '../useMeetingQuery';

type Scope = { roomId: Id<'rooms'>; accessToken?: string };

/** What an element is called in the result: its words, else what it is. */
const labelOf = (el: WhiteboardElement | undefined) =>
  !el ? t`Removed from the board` : elementWords(el) || t`Element without text`;

/** The room's dot vote: the round as this person may see it, and the dots on the board (own ones until the result, then the counts). */
export const useDotVote = (scope: Scope) => {
  const round = withoutError(useMeetingQuery(api.voting.state, scope));
  const canManage = withoutError(useMeetingQuery(api.rooms.canManage, scope)) === true;
  const marks: Record<string, string> = {};
  if (round?.revealed && 'results' in round) for (const r of round.results ?? []) marks[r.elementId] = String(r.votes);
  else for (const id of round?.mine ?? []) marks[id] = (marks[id] ?? '') + '●';
  return { round, canManage, marks: round ? marks : undefined };
};

type Props = ReturnType<typeof useDotVote> & { scope: Scope; selected: WhiteboardElement[]; elements: WhiteboardElement[] };

/** Starting a round, spending one's dots on the selected element, and the sorted result. */
export const DotVote: React.FC<Props> = ({ round, canManage, scope, selected, elements }) => {
  const toast = useToast();
  const control = useMutation(api.voting.control);
  const cast = useMutation(api.voting.cast);
  const take = useMutation(api.voting.take);
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<unknown>) => async () => {
    setBusy(true);
    try { await action(); } catch (error) {
      toast.error(error instanceof Error ? error.message : t`Something went wrong. Please try again.`);
    } finally { setBusy(false); }
  };

  if (!round) {
    return canManage ? (
      <div className="wb__vote">
        <button type="button" className="btn btn--card btn--s" disabled={busy} onClick={run(() => control({ ...scope, action: 'start' }))}>
          <Vote className="icon" aria-hidden="true" /><Trans>Start a dot vote</Trans>
        </button>
      </div>
    ) : null;
  }

  const target = selected.length === 1 ? selected[0] : null;
  const left = round.dots - round.mine.length;
  const voters = round.voters;
  const byId = new Map(elements.map(el => [el.id, el]));

  return (
    <section className="wb__vote stock stock--lift" aria-label={t`Dot vote`}>
      <p className="wb__vote-head"><Vote className="icon" aria-hidden="true" /><Trans>Dot vote</Trans></p>
      {round.revealed && 'results' in round ? (
        <ol className="wb__vote-result" aria-label={t`Result`}>
          {(round.results ?? []).map(r => (
            <li key={r.elementId}>
              <span className="wb__vote-label">{labelOf(byId.get(r.elementId))}</span>
              <span className="fig"><Plural value={r.votes} one="# dot" other="# dots" /></span>
            </li>
          ))}
        </ol>
      ) : (
        <>
          <p className="wb__vote-text">
            {target ? <Trans>Give the selected element a dot.</Trans> : <Trans>Select an element on the board to give it a dot.</Trans>}
          </p>
          <p className="wb__vote-text"><Trans>{left} of {round.dots} dots left</Trans> · <Plural value={voters} one="# person has voted" other="# people have voted" /></p>
          <div className="wb__vote-acts">
            <Button variant="secondary" size="sm" disabled={busy || !target || left <= 0} onClick={run(() => cast({ ...scope, elementId: target!.id }))}>
              <Trans>Give a dot</Trans>
            </Button>
            {target && round.mine.includes(target.id) ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={run(() => take({ ...scope, elementId: target.id }))}>
                <Trans>Take a dot back</Trans>
              </Button>
            ) : null}
          </div>
        </>
      )}
      {canManage ? (
        <div className="wb__vote-acts">
          {round.revealed
            ? <Button variant="secondary" size="sm" disabled={busy} onClick={run(() => control({ ...scope, action: 'start' }))}><Trans>New round</Trans></Button>
            : <Button variant="secondary" size="sm" disabled={busy} onClick={run(() => control({ ...scope, action: 'reveal' }))}><Trans>Show result</Trans></Button>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={run(() => control({ ...scope, action: 'end' }))}><Trans>End vote</Trans></Button>
        </div>
      ) : null}
    </section>
  );
};
