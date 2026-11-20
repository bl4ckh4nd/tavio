import React, { useLayoutEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { ImagePlus, Send, Smile, X } from 'lucide-react';
import { IconButton } from '../../../components/ui';
import { ChatPopover } from './ChatPopover';
import { EmojiPicker } from './EmojiPicker';
import { GifPicker } from './GifPicker';
import type { GifResult } from './chatMedia';

export type PendingAttachment =
  | { kind: 'image'; previewUrl: string; width: number; height: number; uploading: boolean }
  | { kind: 'gif'; gif: GifResult };

interface ChatComposerProps {
  draft: string;
  onDraftChange: (draft: string) => void;
  pending: PendingAttachment | null;
  onRemovePending: () => void;
  onAttachFiles: (files: File[]) => void;
  onPickGif: ((gif: GifResult) => void) | null;
  canAttachImages: boolean;
  disabled: boolean;
  sending: boolean;
  error: string | null;
  darkMode: boolean;
  onSend: () => void;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  draft,
  onDraftChange,
  pending,
  onRemovePending,
  onAttachFiles,
  onPickGif,
  canAttachImages,
  disabled,
  sending,
  error,
  darkMode,
  onSend,
}) => {
  const [popover, setPopover] = useState<'none' | 'emoji' | 'gif'>('none');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !disabled && !sending && (draft.trim().length > 0 || (pending !== null && !(pending.kind === 'image' && pending.uploading)));

  // The field grows with its text up to the cap in CSS.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft]);

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    onDraftChange(draft.slice(0, start) + text + draft.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const toggle = (next: 'emoji' | 'gif') => setPopover((open) => (open === next ? 'none' : next));

  return (
    <form
      className="panel__foot chat-compose"
      // With a sheet open, Escape anywhere in the composer closes the sheet first, not the side panel.
      onKeyDown={(e) => {
        if (e.key === 'Escape' && popover !== 'none') {
          e.preventDefault();
          setPopover('none');
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      {popover === 'emoji' && (
        <ChatPopover label={t`Emoji`} onClose={() => setPopover('none')} className="chat-pop--compose">
          <EmojiPicker darkMode={darkMode} onPick={(emoji) => insertAtCursor(emoji)} />
        </ChatPopover>
      )}
      {popover === 'gif' && onPickGif && (
        <ChatPopover label={t`GIFs`} onClose={() => setPopover('none')} className="chat-pop--compose">
          <GifPicker onPick={(gif) => { setPopover('none'); onPickGif(gif); textareaRef.current?.focus(); }} />
        </ChatPopover>
      )}

      {pending && (
        <div className="chat-compose__pending">
          <span className="chat-compose__thumb">
            <img src={pending.kind === 'image' ? pending.previewUrl : pending.gif.previewUrl} alt="" />
            {pending.kind === 'image' && pending.uploading && <span className="spin" aria-label={t`Uploading image`} />}
          </span>
          <span className="muted min-w-0 flex-1 truncate text-xs">
            {pending.kind === 'image' ? t`Image ready to send` : (pending.gif.title || t`GIF ready to send`)}
          </span>
          <IconButton label={t`Remove attachment`} onClick={onRemovePending}>
            <X className="icon" aria-hidden="true" />
          </IconButton>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="input chat-compose__field"
        rows={1}
        placeholder={t`Type a message...`}
        aria-label={t`Type a message...`}
        value={draft}
        disabled={disabled}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        onPaste={(e) => {
          // Office apps put a picture of the selection next to its text; the text is what was meant.
          if (e.clipboardData.types.includes('text/plain')) return;
          const files = [...e.clipboardData.files].filter((file) => file.type.startsWith('image/'));
          if (files.length > 0 && canAttachImages) {
            e.preventDefault();
            onAttachFiles(files);
          }
        }}
      />

      <div className="chat-compose__tools">
        {canAttachImages && (
          <>
            <IconButton label={t`Add image`} onClick={() => fileRef.current?.click()} disabled={disabled}>
              <ImagePlus className="icon" aria-hidden="true" />
            </IconButton>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                onAttachFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </>
        )}
        <IconButton label={t`Emoji`} onClick={() => toggle('emoji')} isOn={popover === 'emoji'} aria-expanded={popover === 'emoji'} data-popover-trigger="" disabled={disabled}>
          <Smile className="icon" aria-hidden="true" />
        </IconButton>
        {onPickGif && (
          <button
            type="button"
            className={`icon-btn chat-compose__gif ${popover === 'gif' ? 'is-on' : ''}`}
            aria-label={t`GIFs`}
            title={t`GIFs`}
            aria-expanded={popover === 'gif'}
            data-popover-trigger=""
            onClick={() => toggle('gif')}
            disabled={disabled}
          >
            GIF
          </button>
        )}
        <span className="flex-1" />
        <IconButton type="submit" label={t`Send message`} disabled={!canSend}>
          {sending ? <span className="spin" aria-hidden="true" /> : <Send className="icon" aria-hidden="true" />}
        </IconButton>
      </div>
      {error && <p role="alert" className="field__help field__help--error w-full">{error}</p>}
    </form>
  );
};
