import React, { useRef, useState } from 'react';
import { plural, t } from '@lingui/core/macro';
import { SmilePlus } from 'lucide-react';
import { IconButton } from '../../../components/ui';
import { ChatPopover } from './ChatPopover';
import { ChatText } from './ChatText';
import { EmojiPicker } from './EmojiPicker';
import { decodeStoredText, isEmojiOnly } from './chatText';
import type { ChatMessage } from './useChat';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

interface ChatMessageItemProps {
  message: ChatMessage;
  showHeader: boolean;
  darkMode: boolean;
  canReact: boolean;
  onToggleReaction: (emoji: string) => void;
  onOpenImage: (image: { url: string; alt: string }) => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({ message, showHeader, darkMode, canReact, onToggleReaction, onOpenImage }) => {
  const [picking, setPicking] = useState<'none' | 'quick' | 'all'>('none');
  const itemRef = useRef<HTMLDivElement>(null);
  const text = decodeStoredText(message.text);
  const name = decodeStoredText(message.userName);
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const attachment = message.attachment;

  const react = (emoji: string) => {
    setPicking('none');
    onToggleReaction(emoji);
  };

  return (
    <div ref={itemRef} className={`chat__item ${showHeader ? 'chat__item--head' : ''}`}>
      {showHeader ? (
        <p className="chat__who">
          <span className="min-w-0 truncate">{name}</span>
          <span className="fig muted">{time}</span>
        </p>
      ) : (
        <span className="sr-only">{name}, {time}</span>
      )}
      {text && <ChatText text={text} className={isEmojiOnly(text) ? 'chat__msg--emoji' : ''} />}
      {attachment?.kind === 'image' && attachment.url && (
        <button
          type="button"
          className="chat__media"
          style={{ aspectRatio: `${attachment.width} / ${attachment.height}` }}
          onClick={() => onOpenImage({ url: attachment.url!, alt: t`Image from ${name}` })}
          aria-label={t`Open image from ${name}`}
        >
          <img src={attachment.url} alt="" loading="lazy" />
        </button>
      )}
      {attachment?.kind === 'gif' && (
        <span className="chat__media" style={{ aspectRatio: `${attachment.width} / ${attachment.height}` }}>
          <img src={attachment.url} alt={attachment.title ? decodeStoredText(attachment.title) : t`GIF`} loading="lazy" />
        </span>
      )}
      {(message.reactions.length > 0 || canReact) && (
        <div className="chat__reacts">
          {message.reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              className={`chat__react ${reaction.mine ? 'is-on' : ''}`}
              aria-pressed={reaction.mine}
              aria-label={plural(reaction.count, { one: `${reaction.emoji} # reaction`, other: `${reaction.emoji} # reactions` })}
              onClick={() => canReact && onToggleReaction(reaction.emoji)}
              disabled={!canReact}
            >
              <span aria-hidden="true">{reaction.emoji}</span>
              <span className="fig">{reaction.count}</span>
            </button>
          ))}
          {canReact && (
            <IconButton
              label={t`Add reaction`}
              className="chat__add-react"
              data-popover-trigger=""
              aria-expanded={picking !== 'none'}
              onClick={() => setPicking((open) => (open === 'none' ? 'quick' : 'none'))}
            >
              <SmilePlus className="icon" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      )}
      {picking !== 'none' && (
        <ChatPopover label={t`Add reaction`} onClose={() => setPicking('none')} anchor={itemRef.current} className="chat-pop--react">
          {picking === 'quick' ? (
            <div className="chat-quick">
              {QUICK_REACTIONS.map((emoji) => (
                <button key={emoji} type="button" className="chat-quick__btn" onClick={() => react(emoji)} autoFocus={emoji === QUICK_REACTIONS[0]}>
                  {emoji}
                </button>
              ))}
              <button type="button" className="chat-quick__btn chat-quick__more" onClick={() => setPicking('all')} aria-label={t`More emoji`}>
                <SmilePlus className="icon" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <EmojiPicker darkMode={darkMode} onPick={react} />
          )}
        </ChatPopover>
      )}
    </div>
  );
};
