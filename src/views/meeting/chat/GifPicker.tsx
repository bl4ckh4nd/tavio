import React, { useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Button } from '../../../components/ui';
import { type GifResult, searchGifs } from './chatMedia';

interface GifPickerProps {
  onPick: (gif: GifResult) => void;
}

// Trending first, search as you type. Results keep KLIPY's order, as its terms ask.
export const GifPicker: React.FC<GifPickerProps> = ({ onPick }) => {
  const { i18n } = useLingui();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GifResult[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchGifs({ q: query, page, locale: i18n.locale, signal: controller.signal })
        .then((result) => {
          setItems((prev) => (page === 1 ? result.items : [...prev, ...result.items]));
          setHasNext(result.hasNext);
          setError(null);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t`GIF search is unavailable right now.`);
        })
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, page === 1 && query ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, page, i18n.locale]);

  return (
    <div className="chat-gif">
      <input
        ref={inputRef}
        className="input"
        type="search"
        placeholder={t`Search GIFs`}
        aria-label={t`Search GIFs`}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setPage(1); }}
      />
      <div className="chat-gif__grid" aria-busy={loading}>
        {items.map((gif) => (
          <button key={gif.id} type="button" className="chat-gif__item" onClick={() => onPick(gif)} aria-label={gif.title || t`GIF`}>
            <img src={gif.previewUrl} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {error && <p role="alert" className="field__help field__help--error">{error}</p>}
      {!error && !loading && items.length === 0 && <p className="muted text-sm"><Trans>No GIFs found</Trans></p>}
      <div className="chat-gif__foot">
        {hasNext && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setPage((p) => p + 1)} disabled={loading}>
            <Trans>More</Trans>
          </Button>
        )}
        <span className="chat-gif__by"><Trans>Powered by KLIPY</Trans></span>
      </div>
    </div>
  );
};
