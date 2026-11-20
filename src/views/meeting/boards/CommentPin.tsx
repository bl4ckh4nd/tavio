import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation } from 'convex/react';
import { Check, MessageSquare, MessageSquarePlus } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { withoutError } from '../../../hooks/useQueryResult';
import { Button } from '../../../components/ui';
import { useToast } from '../../../components/ToastProvider';
import { formatClock } from '../../../components/sessions/format';
import { useMeetingQuery } from '../useMeetingQuery';

type Scope = { roomId: Id<'rooms'>; accessToken?: string };
type Reply = { name: string; text: string; at: number };
export type CommentThread = { id: string; elementId: string; resolved: boolean; replies: Reply[] };

/** The room's comment threads, by the element they hang on. */
export const useCommentThreads = (scope: Scope) => {
  const threads = withoutError(useMeetingQuery(api.comments.list, scope)) ?? [];
  return new Map<string, CommentThread>(threads.map(thread => [thread.elementId, thread as CommentThread]));
};

/** What people wrote, oldest first; shared by the board and the session history. */
export const CommentReplies: React.FC<{ replies: Reply[] }> = ({ replies }) => (
  <ul className="wb__thread-list">
    {replies.map((reply, index) => (
      <li key={index}>
        <span className="wb__thread-by"><b>{reply.name}</b> <span className="fig">{formatClock(reply.at)}</span></span>
        <p>{reply.text}</p>
      </li>
    ))}
  </ul>
);

type Props = {
  scope: Scope;
  elementId: string;
  thread?: CommentThread;
  me?: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

/** A pin at an element's corner: how many comments it has, and the thread to read, answer and tick done. */
export const CommentPin: React.FC<Props> = ({ scope, elementId, thread, me, open, onOpen, onClose }) => {
  const toast = useToast();
  const add = useMutation(api.comments.add);
  const resolve = useMutation(api.comments.resolve);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // The tick shows at once; the server's answer takes over when it comes.
  const [ticking, setTicking] = useState<boolean | null>(null);
  useEffect(() => setTicking(null), [thread?.resolved]);
  const ref = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  // The thread opens where the board has room for it: below or above the pin, rightward or leftward.
  const [side, setSide] = useState('');
  useLayoutEffect(() => {
    const pin = ref.current?.getBoundingClientRect();
    const sheet = ref.current?.closest('.wb')?.getBoundingClientRect();
    const card = threadRef.current?.getBoundingClientRect();
    if (!open || !pin || !sheet || !card) return;
    setSide(`${pin.bottom + card.height + 6 > sheet.bottom ? 'is-up' : ''} ${pin.left + card.width > sheet.right ? 'is-left' : ''}`);
  }, [open, thread?.replies.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, onClose]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); return true; } catch (error) {
      toast.error(error instanceof Error ? error.message : t`Something went wrong. Please try again.`);
      return false;
    } finally { setBusy(false); }
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.trim() && await run(() => add({ ...scope, elementId, name: me || t`Guest`, text: draft }))) setDraft('');
  };

  const count = thread ? plural(thread.replies.length, { one: '# comment', other: '# comments' }) : '';
  const label = !thread ? t`Comment on this element` : thread.resolved ? t`${count}, done` : count;

  return (
    <div ref={ref} className={`wb__pin-in ${thread?.resolved ? 'is-done' : ''}`}>
      <button type="button" className="wb__pin-btn" aria-label={label} aria-expanded={open} onClick={open ? onClose : onOpen}>
        {!thread ? <MessageSquarePlus className="icon" aria-hidden="true" />
          : thread.resolved ? <Check className="icon" aria-hidden="true" />
          : <MessageSquare className="icon" aria-hidden="true" />}
        {thread ? <span className="fig" aria-hidden="true">{thread.replies.length}</span> : null}
      </button>
      {open ? (
        <div ref={threadRef} className={`wb__thread stock stock--lift ${side}`} role="dialog" aria-label={t`Comments`}>
          {thread ? (
            <>
              <label className="wb__thread-done">
                <input type="checkbox" checked={ticking ?? thread.resolved} disabled={busy}
                  onChange={e => {
                    const resolved = e.target.checked;
                    setTicking(resolved);
                    void run(() => resolve({ ...scope, threadId: thread.id as Id<'boardComments'>, resolved })).then(ok => { if (!ok) setTicking(null); });
                  }} />
                <Trans>Done</Trans>
              </label>
              <CommentReplies replies={thread.replies} />
            </>
          ) : null}
          <form className="wb__thread-form" onSubmit={send}>
            <textarea
              className="input"
              autoFocus
              rows={2}
              maxLength={2000}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(e); }}
              aria-label={t`Comment`}
              placeholder={thread ? t`Reply` : t`Write a comment`}
            />
            <Button type="submit" variant="secondary" size="sm" disabled={busy || !draft.trim()}>
              {thread ? <Trans>Reply</Trans> : <Trans>Comment</Trans>}
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
};
