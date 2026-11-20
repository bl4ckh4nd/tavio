import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation } from 'convex/react';
import { useMaybeRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { Check, ChevronDown, ChevronUp, History, Layers, Lock, Pencil, Plus, Undo2 } from 'lucide-react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { withoutError } from '../../../hooks/useQueryResult';
import { copiesForBoard, PASTE_OFFSET, Whiteboard, type BoardFocus } from '../../../components/Whiteboard';
import { Button, Tag } from '../../../components/ui';
import { useToast } from '../../../components/ToastProvider';
import type { WhiteboardElement, WhiteboardHtml } from '../../../types';
import { PageFrame } from '../../../components/whiteboard/PageFrame';
import { BoardView } from '../../../components/whiteboard/BoardView';
import { formatShortDate } from '../../../components/sessions/format';
import { useMeetingQuery } from '../useMeetingQuery';
import { MeetingRoomContext, type MeetingRoom } from '../MeetingRoomContext';
import { prepareImage, uploadBoardImage } from '../chat/chatMedia';
import { DotVote, useDotVote } from './DotVote';
import { CommentPin, useCommentThreads } from './CommentPin';
import { CURSOR_QUIET_MS, CURSOR_TOPIC, decodeCursor, encodeCursor, liveCursors, type CursorMessage, type LiveCursor } from './boardCursors';

/** A save names the board it was drawn on, so one that arrives after "new board" cannot bring the old board back. */
type SaveElements = (elements: WhiteboardElement[], previous: WhiteboardElement[], generation?: number) => void | Promise<void>;

type RoomBoardProps = {
  onClose?: () => void;
  elements?: WhiteboardElement[];
  onCommit?: SaveElements;
  focus?: BoardFocus;
};

const UNDO_VISIBLE_MS = 12000;
const BOARD_NAME_MAX = 60;
const HINT_SEEN_KEY = 'tavio:board-hint-seen';

/** Pointer positions go out at most this often: smooth enough to follow, light on the call. */
const CURSOR_EVERY_MS = 50;

/** The others' cursors on the board, and a way to send one's own, over the call's data channel. */
const useBoardCursors = () => {
  const call = useMaybeRoomContext();
  const [cursors, setCursors] = useState<Record<string, LiveCursor>>({});
  const lastSentRef = useRef(0);
  const pendingRef = useRef<CursorMessage | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!call) return;
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== CURSOR_TOPIC || !participant) return;
      const message = decodeCursor(payload);
      // The name comes from the call, never from the message.
      if (message) setCursors(prev => liveCursors(prev, participant.identity, participant.name || participant.identity, message, Date.now()));
    };
    const onLeft = (participant: RemoteParticipant) => setCursors(prev => {
      if (!(participant.identity in prev)) return prev;
      const { [participant.identity]: _gone, ...rest } = prev;
      return rest;
    });
    // A cursor whose owner went quiet without saying goodbye fades out.
    const sweep = window.setInterval(() => setCursors(prev => {
      const now = Date.now();
      const fresh = Object.entries(prev).filter(([, cursor]) => now - cursor.at < CURSOR_QUIET_MS);
      return fresh.length === Object.keys(prev).length ? prev : Object.fromEntries(fresh);
    }), 1000);
    call.on(RoomEvent.DataReceived, onData);
    call.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => {
      call.off(RoomEvent.DataReceived, onData);
      call.off(RoomEvent.ParticipantDisconnected, onLeft);
      window.clearInterval(sweep);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      void call.localParticipant.publishData(encodeCursor({ hide: true }), { reliable: true, topic: CURSOR_TOPIC }).catch(() => undefined);
    };
  }, [call]);

  const send = useCallback((message: CursorMessage) => {
    if (!call) return;
    pendingRef.current = message;
    const flush = () => {
      timerRef.current = null;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (!next) return;
      lastSentRef.current = Date.now();
      // Positions may drop on the way; a hide or a sentence must arrive.
      const reliable = 'hide' in next || !!next.chat;
      void call.localParticipant.publishData(encodeCursor(next), { reliable, topic: CURSOR_TOPIC }).catch(() => undefined);
    };
    const wait = CURSOR_EVERY_MS - (Date.now() - lastSentRef.current);
    if (wait <= 0) flush();
    else if (timerRef.current === null) timerRef.current = window.setTimeout(flush, wait);
  }, [call]);

  // Notes and stamps carry the name; the board keeps it to 60 characters.
  return { cursors, send: call ? send : undefined, me: call?.localParticipant.name?.slice(0, 60) || undefined };
};

/** A page of HTML on the board, loaded for this room only. */
const BoardPage: React.FC<{ el: WhiteboardHtml; room: MeetingRoom }> = ({ el, room }) => {
  const page = withoutError(useMeetingQuery(api.whiteboard.html, { roomId: room.roomId, accessToken: room.accessToken, page: el.page as Id<'boardPages'> }));
  if (!page) return null;
  return 'spec' in page && page.spec !== undefined ? <BoardView spec={page.spec} title={el.title} /> : <PageFrame html={page.html ?? ''} title={el.title} />;
};

const readSeenHint = () => {
  try { return sessionStorage.getItem(HINT_SEEN_KEY); } catch { return null; }
};

export const RoomBoard: React.FC<RoomBoardProps> = (props) => {
  const room = useContext(MeetingRoomContext);
  if (!room) {
    return (
      <Whiteboard
        {...props}
      />
    );
  }
  return <BoardOfRoom room={room} {...props} />;
};

const BoardOfRoom: React.FC<RoomBoardProps & { room: MeetingRoom }> = ({ room, onClose, onCommit, focus }) => {
  const toast = useToast();
  const board = useBoardCursors();
  const roomId = room.roomId as Id<'rooms'>;
  const scope = { roomId, accessToken: room.accessToken };

  const wall = withoutError(useMeetingQuery(api.whiteboard.get, { roomId: room.roomId, accessToken: room.accessToken }));
  const elements = wall?.elements as WhiteboardElement[] | undefined;
  const filedBoards = withoutError(useMeetingQuery(api.boards.list, scope)) ?? [];
  const sessions = withoutError(useMeetingQuery(api.roomSessions.current, scope));

  const [viewingId, setViewingId] = useState<Id<'whiteboardArchive'> | null>(null);
  const viewingResult = useMeetingQuery(api.boards.get, viewingId ? { ...scope, archiveId: viewingId } : 'skip');
  const viewing = withoutError(viewingResult);

  const startNew = useMutation(api.boards.startNew);
  const undoStartNew = useMutation(api.boards.undoStartNew);
  const restore = useMutation(api.boards.restore);
  const rename = useMutation(api.boards.rename);

  const [menuOpen, setMenuOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [selected, setSelected] = useState<WhiteboardElement[]>([]);
  const [filed, setFiled] = useState<{ archiveId: Id<'whiteboardArchive'>; startedAt: number | null; canUndo: boolean } | null>(null);
  const [seenHint, setSeenHint] = useState<string | null>(readSeenHint);
  const vote = useDotVote(scope);
  const threads = useCommentThreads(scope);
  const [openPin, setOpenPin] = useState<string | null>(null);
  const closePin = useCallback(() => setOpenPin(null), []);
  const renderPin = (el: WhiteboardElement, isSelected: boolean) => {
    const thread = threads.get(el.id);
    if (!thread && !isSelected && openPin !== el.id) return null;
    return (
      <CommentPin scope={scope} elementId={el.id} thread={thread} me={board.me}
        open={openPin === el.id} onOpen={() => setOpenPin(el.id)} onClose={closePin} />
    );
  };
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const generation = wall?.generation ?? 0;
  const boardStartedAt = wall?.boardStartedAt ?? null;
  const boardName = wall?.name ?? null;

  // The menu closes on a click elsewhere and on Escape, like every menu in the app.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!filed) return;
    const timer = window.setTimeout(() => setFiled(null), UNDO_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [filed]);

  // A filed board that was deleted meanwhile has nothing left to show.
  useEffect(() => {
    if (viewingId && viewing === null) setViewingId(null);
  }, [viewingId, viewing]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t`Something went wrong. Please try again.`);
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const dismissHint = (sessionId: string) => {
    setSeenHint(sessionId);
    try { sessionStorage.setItem(HINT_SEEN_KEY, sessionId); } catch { /* the hint simply returns after a reload */ }
  };

  const storePage = useMutation(api.whiteboard.addHtml);
  const addPage = useCallback(async (title: string, html: string) => {
    try {
      return await storePage({ roomId: room.roomId, accessToken: room.accessToken, title, html });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t`The page could not be added.`);
      return null;
    }
  }, [room.roomId, room.accessToken, storePage, toast]);
  const renderPage = useCallback((el: WhiteboardHtml) => <BoardPage el={el} room={room} />, [room]);

  const uploadImage = useCallback(async (image: File) => {
    try {
      const { blob, previewUrl } = await prepareImage(image);
      URL.revokeObjectURL(previewUrl);
      return await uploadBoardImage(room.roomId, room.accessToken, blob);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t`The image could not be uploaded.`);
      return null;
    }
  }, [room.roomId, room.accessToken, toast]);

  const handleNewBoard = () => run(async () => {
    setMenuOpen(false);
    const startedAt = boardStartedAt;
    const result = await startNew({ ...scope, keepElementIds: selected.map(el => el.id) });
    if (wall?.carriedOver) dismissHint(wall.carriedOver.sessionId);
    if (result.archiveId) setFiled({ archiveId: result.archiveId as Id<'whiteboardArchive'>, startedAt, canUndo: true });
  });

  const handleUndoNewBoard = () => run(async () => {
    if (!filed) return;
    await undoStartNew({ ...scope, archiveId: filed.archiveId });
    setFiled(null);
  });

  const handleRestore = () => run(async () => {
    if (!viewingId) return;
    const startedAt = boardStartedAt;
    const result = await restore({ ...scope, archiveId: viewingId });
    setViewingId(null);
    setFiled(result.archiveId ? { archiveId: result.archiveId as Id<'whiteboardArchive'>, startedAt, canUndo: false } : null);
  });

  // Copies of the selection go onto the board on the wall; the filed board stays as it was.
  const handleTakeSelection = () => {
    if (selected.length === 0) return;
    const onWall = elements ?? [];
    // On a board that already holds the same thing in the same place, the copy would lie exactly on top of it.
    const shape = ({ id: _id, ...rest }: WhiteboardElement) => JSON.stringify(rest);
    const taken = new Set(onWall.map(shape));
    const offset = selected.some(el => taken.has(shape(el))) ? PASTE_OFFSET : 0;
    onCommit?.([...onWall, ...copiesForBoard(selected, offset)], onWall, generation);
    setViewingId(null);
  };

  const handleRename = () => run(async () => {
    if (naming === null) return;
    await rename({ ...scope, name: naming });
    setNaming(null);
  });

  const openHistory = () => {
    setMenuOpen(false);
    window.open(`/admin/room/${room.roomSlug}`, '_blank', 'noopener');
  };

  const boardLabel = (name: string | null, startedAt: number | null) => (
    <>
      <span>{name || <Trans>Board</Trans>}</span>
      {startedAt ? <span className="fig">{formatShortDate(startedAt)}</span> : null}
    </>
  );

  if (!wall) return <div className="mquiet" role="status"><Trans>Loading...</Trans></div>;

  if (viewingId) {
    const viewingDate = viewing ? formatShortDate(viewing.boardStartedAt) : '';
    return (
      <Whiteboard
        key={viewingId}
        readOnly
        renderPage={renderPage}
        boardSource={viewingId}
        pageRoom={room.roomId}
        elements={viewing?.elements as WhiteboardElement[] | undefined}
        onSelectionChange={setSelected}
        onClose={onClose}
      >
        <div className="wb__banner">
          <span className="wb__banner-l">
            <Tag><Lock className="icon" aria-hidden="true" /><Trans>Read-only</Trans></Tag>
            <span>{viewing?.name ? `${viewing.name} · ` : ''}<Trans>Board from</Trans> <span className="fig">{viewingDate}</span></span>
          </span>
          <span className="wb__hint-acts">
            {selected.length > 0 && (
              <Button variant="secondary" size="sm" onClick={handleTakeSelection}>
                <Trans>Copy selection to the current board</Trans>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setViewingId(null)}><Trans>Back to the current board</Trans></Button>
            <Button variant="secondary" size="sm" disabled={busy || !viewing} onClick={handleRestore}><Trans>Put back on the board</Trans></Button>
          </span>
        </div>
      </Whiteboard>
    );
  }

  const carried = wall?.carriedOver && wall.carriedOver.sessionId !== seenHint ? wall.carriedOver : null;
  const startedThisSession = !!boardStartedAt && !!sessions && boardStartedAt >= sessions.currentFrom;

  return (
    <Whiteboard
      // A different board on the wall is a different whiteboard: nothing drawn on the old one may reach it.
      key={`wall-${generation}`}
      focus={focus}
      uploadImage={uploadImage}
      addPage={addPage}
      renderPage={renderPage}
      me={board.me}
      cursors={board.cursors}
      onCursor={board.send}
      boardSource={`wall-${room.roomId}-${generation}`}
      pageRoom={room.roomId}
      elements={elements}
      onCommit={(next, previous) => onCommit?.(next, previous, generation)}
      marks={vote.marks}
      renderPin={renderPin}
      onSelectionChange={setSelected}
      onNewBoard={handleNewBoard}
      onClose={onClose}
    >
      <div className="wb__which" ref={menuRef}>
        <button
          type="button"
          className="btn btn--card btn--s"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >
          <Layers className="icon" aria-hidden="true" />
          {boardLabel(boardName, boardStartedAt)}
          {menuOpen ? <ChevronUp className="icon" aria-hidden="true" /> : <ChevronDown className="icon" aria-hidden="true" />}
        </button>

        {menuOpen && (
          <div className="menu wb__menu stock stock--lift" role="menu" aria-label={t`Boards of this room`}>
            <p className="menu__head"><Trans>On the board</Trans></p>
            {naming === null ? (
              <>
                <div className="menu__item wb__menu-now" role="menuitemradio" aria-checked="true">
                  <Check className="icon" aria-hidden="true" />
                  {boardLabel(boardName, boardStartedAt)}
                  {startedThisSession ? <span className="menu__end"><Trans>This session</Trans></span> : null}
                </div>
                <button type="button" className="menu__item" role="menuitem" onClick={() => setNaming(boardName ?? '')}>
                  <Pencil className="icon" aria-hidden="true" /><span><Trans>Name this board</Trans></span>
                </button>
              </>
            ) : (
              <form className="wb__name" onSubmit={(e) => { e.preventDefault(); void handleRename(); }}>
                <input
                  className="input"
                  autoFocus
                  value={naming}
                  maxLength={BOARD_NAME_MAX}
                  onChange={e => setNaming(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }}
                  aria-label={t`Board name`}
                  placeholder={t`Board name`}
                />
                <Button type="submit" variant="secondary" size="sm" disabled={busy}><Trans>Save</Trans></Button>
              </form>
            )}

            {filedBoards.length > 0 && (
              <>
                <div className="menu__rule" />
                <p className="menu__head"><Trans>Filed</Trans></p>
                <div className="wb__menu-list">
                  {filedBoards.map(board => (
                    <button
                      key={board.id}
                      type="button"
                      className="menu__item"
                      role="menuitemradio"
                      aria-checked="false"
                      onClick={() => { setMenuOpen(false); setSelected([]); setViewingId(board.id as Id<'whiteboardArchive'>); }}
                    >
                      <Layers className="icon" aria-hidden="true" />
                      {boardLabel(board.name, board.boardStartedAt)}
                      <span className="menu__end"><Trans>View</Trans></span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="menu__rule" />
            <button type="button" className="menu__item" role="menuitem" disabled={busy || (elements ?? []).length === 0} onClick={handleNewBoard}>
              <Plus className="icon" aria-hidden="true" />
              <span>{selected.length > 0 ? <Trans>New board with the selection</Trans> : <Trans>New board</Trans>}</span>
            </button>
            {sessions?.canSeeEarlier && room.roomSlug ? (
              <button type="button" className="menu__item" role="menuitem" onClick={openHistory}>
                <History className="icon" aria-hidden="true" /><span><Trans>Open the room's history</Trans></span>
              </button>
            ) : null}
          </div>
        )}
      </div>

      <DotVote {...vote} scope={scope} selected={selected} elements={elements ?? []} />

      {filed ? (
        <div className="wb__hint stock stock--lift" role="status">
          <span>
            {filed.startedAt
              ? <Trans>The board from <span className="fig">{formatShortDate(filed.startedAt)}</span> is in the history.</Trans>
              : <Trans>The previous board is in the history.</Trans>}
          </span>
          {filed.canUndo ? (
            <span className="wb__hint-acts">
              <Button variant="secondary" size="sm" disabled={busy} onClick={handleUndoNewBoard}>
                <Undo2 className="icon" aria-hidden="true" /><Trans>Undo</Trans>
              </Button>
            </span>
          ) : null}
        </div>
      ) : carried ? (
        <div className="wb__hint stock stock--lift" role="status">
          <span>
            {carried.from
              ? <Trans>This board is from the session on <span className="fig">{formatShortDate(carried.from)}</span>.</Trans>
              : <Trans>This board is from an earlier session.</Trans>}
          </span>
          <span className="wb__hint-acts">
            <Button variant="ghost" size="sm" onClick={() => dismissHint(carried.sessionId)}><Trans>Keep working</Trans></Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={handleNewBoard}>
              <Plus className="icon" aria-hidden="true" /><Trans>New board</Trans>
            </Button>
          </span>
        </div>
      ) : null}
    </Whiteboard>
  );
};
