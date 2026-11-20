import React, { useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';

// emoji-picker-element is a web component. It and its data load on first open, and the data is
// served from this app, never from the library's default CDN.
const DATA: Record<string, () => Promise<{ default: string }>> = {
  de: () => import('emoji-picker-element-data/de/cldr/data.json?url'),
  en: () => import('emoji-picker-element-data/en/cldr/data.json?url'),
  es: () => import('emoji-picker-element-data/es/cldr/data.json?url'),
  fr: () => import('emoji-picker-element-data/fr/cldr/data.json?url'),
};
const I18N: Record<string, () => Promise<{ default: unknown }>> = {
  de: () => import('emoji-picker-element/i18n/de.js'),
  es: () => import('emoji-picker-element/i18n/es.js'),
  fr: () => import('emoji-picker-element/i18n/fr.js'),
};

interface EmojiPickerProps {
  darkMode: boolean;
  onPick: (emoji: string) => void;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ darkMode, onPick }) => {
  const { i18n } = useLingui();
  const locale = DATA[i18n.locale] ? i18n.locale : 'en';
  const hostRef = useRef<HTMLDivElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const darkRef = useRef(darkMode);
  darkRef.current = darkMode;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let picker: HTMLElement | null = null;
    let cancelled = false;
    (async () => {
      const [{ Picker }, data, strings] = await Promise.all([
        import('emoji-picker-element'),
        DATA[locale](),
        I18N[locale]?.() ?? Promise.resolve(null),
      ]);
      if (cancelled || !hostRef.current) return;
      picker = new Picker({
        locale,
        dataSource: data.default,
        ...(strings ? { i18n: strings.default as any } : {}),
      });
      picker.addEventListener('emoji-click', (event: any) => {
        const unicode = event.detail?.unicode;
        if (unicode) onPickRef.current(unicode);
      });
      picker.classList.add(darkRef.current ? 'dark' : 'light');
      hostRef.current.appendChild(picker);
      requestAnimationFrame(() => (picker?.shadowRoot?.querySelector('input') as HTMLInputElement | null)?.focus());
    })().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      picker?.remove();
    };
  }, [locale]);

  useEffect(() => {
    const picker = hostRef.current?.firstElementChild;
    picker?.classList.toggle('dark', darkMode);
    picker?.classList.toggle('light', !darkMode);
  }, [darkMode]);

  if (failed) return <p className="muted p-3 text-sm"><Trans>Emoji could not be loaded.</Trans></p>;
  return <div ref={hostRef} className="chat-emoji" />;
};
