import React, { useContext, useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { plural, t } from '@lingui/core/macro';
import { useAction, useMutation } from 'convex/react';
import { AudioLines, Bot, Check, MessageSquare, Undo2 } from 'lucide-react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button, Tag } from '../../../components/ui';
import { useToast } from '../../../components/ToastProvider';
import { MeetingRoomContext } from '../MeetingRoomContext';
import { useAssistant } from './assistantParticipant';
import { useAnnounceLanguage } from './useAnnounceLanguage';

export type AssistantEdit = FunctionReturnType<typeof api.assistant.recent>[number];

const HINT_SEEN_KEY = 'tavio:assistant-hint-seen';
const TOAST_MS = 10000;

/** Bringing the assistant in and sending it away. Anyone in the room may do either. */
export const useAssistantControl = () => {
  const room = useContext(MeetingRoomContext);
  const { present, state } = useAssistant();
  const summon = useAction(api.assistantDispatch.summon);
  const dismiss = useAction(api.assistantDispatch.dismiss);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (action: typeof summon) => {
    if (!room) return;
    setBusy(true);
    try {
      await action({ roomId: room.roomId as Id<'rooms'>, accessToken: room.accessToken });
    } catch {
      toast.error(present ? t`The assistant could not be sent away. Please try again.` : t`The assistant could not join. Please try again.`);
    } finally {
      setBusy(false);
    }
  };

  return {
    available: !!room,
    present,
    state,
    busy,
    summon: () => run(summon),
    dismiss: () => run(dismiss),
  };
};

/** Everyone sees that the assistant is listening, not only the person who brought it in. */
export const AssistantStatus: React.FC = () => {
  const { present, state } = useAssistant();
  if (!present) return null;
  return (
    <Tag variant="board" className="shrink-0">
      <AudioLines className="icon" aria-hidden="true" />
      <span>
        {state === 'thinking' ? <Trans>Assistant is writing</Trans> : state === 'heard' ? <Trans>Assistant heard you</Trans> : <Trans>Assistant is listening</Trans>}
      </span>
    </Tag>
  );
};

const readHintSeen = () => {
  try { return sessionStorage.getItem(HINT_SEEN_KEY) === '1'; } catch { return false; }
};

const doneLabel = (edit: AssistantEdit) => {
  const count = edit.count ?? 0;
  switch (edit.action) {
    case 'add': return plural(count, { one: 'Put # note on the board', other: 'Put # notes on the board' });
    case 'connect': return plural(count, { one: 'Drew # arrow', other: 'Drew # arrows' });
    case 'change': return plural(count, { one: 'Changed # element', other: 'Changed # elements' });
    case 'overview': return t`Put an overview on the board`;
    case 'tasks': return plural(count, { one: 'Put # task on the board', other: 'Put # tasks on the board' });
    case 'mindmap': return plural(count, { one: 'Put # idea on the mind map', other: 'Put # ideas on the mind map' });
    case 'arrange': return t`Rearranged the board`;
    case 'delete': return plural(count, { one: 'Removed # element from the board', other: 'Removed # elements from the board' });
    case 'show': return t`Moved the view`;
    case 'append': return t`Written into the notes`;
    case 'remove': return t`Taken out of the notes`;
    default: return edit.text ?? '';
  }
};

/** One spoken command can change several things; they show as one line, oldest first. */
const commandOf = (edits: AssistantEdit[], key: string) =>
  edits.filter(edit => (edit.commandId ?? edit.id) === key).reverse();

const commandLabel = (group: AssistantEdit[]) => {
  const undoable = group.filter(edit => edit.canUndo || edit.undoneAt);
  if (undoable.length > 0 && undoable.every(edit => edit.undoneAt)) return t`Undone`;
  // Bringing its own change into view is part of the change, not news of its own.
  const told = group.length > 1 ? group.filter(edit => edit.action !== 'show') : group;
  return [...new Set(told.map(doneLabel))].join(' · ');
};

/**
 * The first time the assistant is in the room it explains how to talk to it. After that, every
 * change it makes shows once: what it heard, what it did, and a way to take it back.
 */
export const AssistantOverlay: React.FC<{ edits: AssistantEdit[] | undefined }> = ({ edits }) => {
  const room = useContext(MeetingRoomContext);
  const control = useAssistantControl();
  const undo = useMutation(api.assistant.undo);
  useAnnounceLanguage();
  const [hintSeen, setHintSeen] = useState(readHintSeen);
  const [shownId, setShownId] = useState<string | null>(null);
  const knownRef = useRef<Set<string> | null>(null);

  // Only what happens while you are here shows; the history the room had before stays quiet.
  useEffect(() => {
    if (!edits) return;
    if (!knownRef.current) {
      knownRef.current = new Set(edits.map(edit => edit.id));
      return;
    }
    const fresh = edits.find(edit => !knownRef.current!.has(edit.id));
    for (const edit of edits) knownRef.current.add(edit.id);
    if (fresh) setShownId(fresh.commandId ?? fresh.id);
  }, [edits]);

  useEffect(() => {
    if (!shownId) return;
    const timer = window.setTimeout(() => setShownId(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [shownId]);

  const closeHint = () => {
    setHintSeen(true);
    try { sessionStorage.setItem(HINT_SEEN_KEY, '1'); } catch { /* the hint simply shows again after a reload */ }
  };

  const shown = edits && shownId ? commandOf(edits, shownId) : [];

  if (control.present && !hintSeen) {
    return (
      <div className="mtoast mhint stock stock--lift" role="dialog" aria-labelledby="assistant-hint-title">
        <p id="assistant-hint-title" className="mhint__title"><Trans>Say “Vivo”, then what you need.</Trans></p>
        <ul className="mhint__list">
          <li><Trans>“Vivo, put on the board: release on December 3.”</Trans></li>
          <li><Trans>“Vivo, add a task: Jonas sends the numbers.”</Trans></li>
          <li><Trans>“Vivo, summarize the last ten minutes into the notes.”</Trans></li>
        </ul>
        <p className="mhint__note"><Trans>Everyone in the call sees that the assistant is listening. It keeps only what it writes down.</Trans></p>
        <div className="mhint__acts">
          <Button variant="ghost" size="sm" disabled={control.busy} onClick={() => { closeHint(); void control.dismiss(); }}>
            <Trans>Send the assistant away</Trans>
          </Button>
          <Button variant="secondary" size="sm" onClick={closeHint}><Trans>Got it</Trans></Button>
        </div>
      </div>
    );
  }

  if (shown.length === 0 || !room) return null;
  const isReply = shown.every(edit => edit.kind === 'reply');
  const undoable = shown.find(edit => edit.canUndo);
  return (
    <div role="status" className="toast mtoast mtoast--assistant">
      <span className="mtoast__heard"><Trans>“{shown[0].heard}”</Trans></span>
      <span className="mtoast__done">
        {isReply ? <MessageSquare className="icon" aria-hidden="true" /> : <Check className="icon" aria-hidden="true" />}
        <span className="min-w-0 flex-1">{commandLabel(shown)}</span>
        {undoable && (
          <button
            type="button"
            className="btn btn--ghost btn--s"
            onClick={() => void undo({ roomId: room.roomId as Id<'rooms'>, accessToken: room.accessToken, editId: undoable.id as Id<'assistantEdits'> })}
          >
            <Undo2 className="icon" aria-hidden="true" /><Trans>Undo</Trans>
          </button>
        )}
      </span>
    </div>
  );
};

/** The entry in the "More" menu. It lives here so the menu needs the room's backend only when there is a room. */
export const AssistantMenuItem: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const control = useAssistantControl();
  return (
    <button
      type="button"
      role="menuitem"
      className="menu__item"
      disabled={control.busy}
      aria-busy={control.busy}
      onClick={() => { onDone(); void (control.present ? control.dismiss() : control.summon()); }}
    >
      <Bot className="icon" aria-hidden="true" />
      <span>{control.present ? t`Send the assistant away` : t`Bring in the assistant`}</span>
    </button>
  );
};
