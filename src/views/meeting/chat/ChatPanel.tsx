import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { ArrowDown, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Button, Modal, Notice } from '../../../components/ui';
import { ChatComposer, type PendingAttachment } from './ChatComposer';
import { ChatMessageItem } from './ChatMessageItem';
import { KLIPY_API_KEY, isChatImageFile, prepareImage, uploadChatImage } from './chatMedia';
import { replaceShortcodes } from './chatText';
import type { ChatMessage, ChatState } from './useChat';
import type { Id } from '../../../../convex/_generated/dataModel';
import { withoutError } from '../../../hooks/useQueryResult';
import { formatSessionStart } from '../../../components/sessions/format';
import { splitChatBySession } from '../sessions/chatSessions';
import { useMeetingQuery } from '../useMeetingQuery';

// Messages from one person within this gap share a header.
const GROUP_GAP_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 48;

interface ChatPanelProps {
  chat: ChatState;
  roomId: string | undefined;
  roomAccessToken: string | undefined;
  userName: string;
  darkMode: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ chat, roomId, roomAccessToken, userName, darkMode }) => {
  const sendChat = useMutation(api.chat.send);
  const toggleReaction = useMutation(api.chat.toggleReaction);
  const { messages, loading, failed, draft, setDraft, markRead } = chat;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const uploadRef = useRef<{ token: number; uploadId: Promise<string> } | null>(null);
  const uploadTokenRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [openImage, setOpenImage] = useState<{ url: string; alt: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const sentByMeRef = useRef(false);
  const [newBelow, setNewBelow] = useState(false);
  // The chat starts fresh with every session; what earlier sessions wrote folds away above it.
  const sessions = withoutError(useMeetingQuery(
    api.roomSessions.current,
    roomId ? { roomId: roomId as Id<'rooms'>, accessToken: roomAccessToken } : 'skip',
  ));
  const [showEarlier, setShowEarlier] = useState(false);
  const bySession = splitChatBySession(messages ?? [], sessions as any);

  const canAttachImages = Boolean(roomId && roomAccessToken && import.meta.env.VITE_CONVEX_SITE_URL);
  const disabled = !roomId || failed;

  const scrollToEnd = useCallback(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
    setNewBelow(false);
  }, []);

  // Follow new messages while the reader is at the end; otherwise offer a way down.
  const lastMessageId = messages?.[messages.length - 1]?.id;
  useLayoutEffect(() => {
    if (!lastMessageId) return;
    if (nearBottomRef.current || sentByMeRef.current) scrollToEnd();
    else setNewBelow(true);
    sentByMeRef.current = false;
  }, [lastMessageId, scrollToEnd]);

  const clearPending = useCallback(() => {
    setPending((current) => {
      if (current?.kind === 'image') URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    uploadRef.current = null;
  }, []);

  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => {
    if (pendingRef.current?.kind === 'image') URL.revokeObjectURL(pendingRef.current.previewUrl);
  }, []);

  const attachFiles = useCallback(async (files: File[]) => {
    const file = files.find(isChatImageFile);
    if (!file) {
      if (files.length > 0) setError(t`Only PNG, JPEG, GIF and WebP images can be shared.`);
      return;
    }
    if (!roomId || !roomAccessToken) return;
    setError(null);
    const token = ++uploadTokenRef.current;
    try {
      const image = await prepareImage(file);
      if (token !== uploadTokenRef.current) return URL.revokeObjectURL(image.previewUrl);
      clearPending();
      setPending({ kind: 'image', previewUrl: image.previewUrl, width: image.width, height: image.height, uploading: true });
      const uploadId = uploadChatImage(roomId, roomAccessToken, image.blob);
      uploadRef.current = { token, uploadId };
      await uploadId;
      if (token === uploadTokenRef.current) {
        setPending((current) => (current?.kind === 'image' ? { ...current, uploading: false } : current));
      }
    } catch (err) {
      if (token !== uploadTokenRef.current) return;
      clearPending();
      setError(err instanceof Error ? err.message : t`The image could not be uploaded.`);
    }
  }, [clearPending, roomAccessToken, roomId]);

  const handleSend = async () => {
    if (!roomId) return;
    const text = replaceShortcodes(draft).trim();
    setSending(true);
    try {
      let attachment: any = undefined;
      if (pending?.kind === 'image' && uploadRef.current) {
        attachment = { kind: 'image', uploadId: await uploadRef.current.uploadId, width: pending.width, height: pending.height };
      } else if (pending?.kind === 'gif') {
        const { url, width, height, title } = pending.gif;
        attachment = { kind: 'gif', url, width, height, ...(title ? { title } : {}) };
      }
      if (!text && !attachment) return;
      sentByMeRef.current = true;
      await sendChat({ roomId, userName, text, accessToken: roomAccessToken, attachment });
      setDraft('');
      clearPending();
      setError(null);
      markRead(Date.now());
    } catch {
      sentByMeRef.current = false;
      setError(t`Message not sent. Try again.`);
    } finally {
      setSending(false);
    }
  };

  const handleReaction = (messageId: any, emoji: string) => {
    if (!roomId) return;
    toggleReaction({ roomId, messageId, emoji, accessToken: roomAccessToken }).catch(() => setError(t`Reaction not saved. Try again.`));
  };

  const renderMessages = (list: ChatMessage[], canReact: boolean) => list.map((message, index, all) => {
    const previous = all[index - 1];
    const showHeader = !previous || previous.userId !== message.userId || message.timestamp - previous.timestamp > GROUP_GAP_MS;
    return (
      <ChatMessageItem
        key={message.id}
        message={message}
        showHeader={showHeader}
        darkMode={darkMode}
        canReact={canReact}
        onToggleReaction={(emoji) => handleReaction(message.id, emoji)}
        onOpenImage={setOpenImage}
      />
    );
  });

  const hasFiles = (event: React.DragEvent) => [...event.dataTransfer.types].includes('Files');

  return (
    <div
      className="chat-panel"
      onDragEnter={(e) => { if (canAttachImages && hasFiles(e)) { e.preventDefault(); setDragging(true); } }}
      onDragOver={(e) => { if (canAttachImages && hasFiles(e)) e.preventDefault(); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => {
        if (!canAttachImages || !hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        void attachFiles([...e.dataTransfer.files]);
      }}
    >
      <div
        ref={bodyRef}
        className="panel__body"
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          if (nearBottomRef.current) setNewBelow(false);
        }}
      >
        {failed ? (
          <div className="mquiet"><Notice variant="error"><Trans>Chat could not be loaded. Leave the meeting and join again to retry.</Trans></Notice></div>
        ) : loading ? (
          <div className="mquiet"><p className="empty__title"><Trans>Loading...</Trans></p></div>
        ) : (messages || []).length === 0 ? (
          <div className="mquiet"><p className="empty__title"><Trans>No messages yet</Trans></p></div>
        ) : (
          <>
            {bySession.earlier.length > 0 && (
              <button type="button" className="chat__earlier" aria-expanded={showEarlier} onClick={() => setShowEarlier(open => !open)}>
                <span><Trans>Earlier sessions</Trans></span>
                <span className="fig">{bySession.earlier.length}</span>
                {showEarlier ? <ChevronUp className="icon" aria-hidden="true" /> : <ChevronDown className="icon" aria-hidden="true" />}
              </button>
            )}
            <div className="chat" role="log" aria-label={t`Messages`}>
              {showEarlier && bySession.earlier.map(group => (
                <div key={group.key} className="chat chat--past">
                  <p className="sesline">{formatSessionStart(group.startedAt)}</p>
                  {renderMessages(group.messages, false)}
                </div>
              ))}
              {bySession.earlier.length > 0 && bySession.currentStartedAt !== null && (
                <p className="sesline">{formatSessionStart(bySession.currentStartedAt)}</p>
              )}
              {renderMessages(bySession.current, !disabled)}
              {bySession.current.length === 0 && <p className="muted text-sm"><Trans>No messages in this session yet</Trans></p>}
            </div>
          </>
        )}
      </div>

      {newBelow && (
        <Button type="button" variant="secondary" size="sm" className="chat-panel__jump" onClick={scrollToEnd}>
          <ArrowDown className="icon" aria-hidden="true" />
          <Trans>New messages</Trans>
        </Button>
      )}

      <ChatComposer
        draft={draft}
        onDraftChange={setDraft}
        pending={pending}
        onRemovePending={() => { uploadTokenRef.current++; clearPending(); }}
        onAttachFiles={(files) => void attachFiles(files)}
        onPickGif={KLIPY_API_KEY ? (gif) => { uploadTokenRef.current++; clearPending(); setPending({ kind: 'gif', gif }); } : null}
        canAttachImages={canAttachImages}
        disabled={disabled}
        sending={sending}
        error={error}
        darkMode={darkMode}
        onSend={() => void handleSend()}
      />

      {dragging && (
        <div className="chat-panel__drop" aria-hidden="true">
          <Trans>Drop the image to share it</Trans>
        </div>
      )}

      {/* The panel clips fixed layers, so the image opens on the body. Escape closes the image, not the panel. */}
      {createPortal(<div onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault(); }}>
        <Modal isOpen={openImage !== null} onClose={() => setOpenImage(null)} ariaLabel={openImage?.alt} className="chat-lightbox max-w-[min(960px,calc(100vw-1.5rem))]!">
          {openImage && (
            <>
              <img src={openImage.url} alt={openImage.alt} className="chat-lightbox__img" />
              <div className="dialog__actions">
                <a className="btn btn--ghost" href={openImage.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="icon" aria-hidden="true" />
                  <Trans>Open original</Trans>
                </a>
                <Button type="button" variant="secondary" onClick={() => setOpenImage(null)}><Trans>Close</Trans></Button>
              </div>
            </>
          )}
        </Modal>
      </div>, document.body)}
    </div>
  );
};
