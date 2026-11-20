import { i18n } from "@lingui/core";

export const SUPPORTED_LOCALES = ["en", "de", "es", "fr"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
};

const STORAGE_KEY = "tavio:locale";

export function getInitialLocale(): SupportedLocale {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.includes(stored as SupportedLocale)) {
      return stored as SupportedLocale;
    }
    const browserLang = navigator.language.split("-")[0];
    if (SUPPORTED_LOCALES.includes(browserLang as SupportedLocale)) {
      return browserLang as SupportedLocale;
    }
  }
  return "en";
}

export function persistLocale(locale: SupportedLocale): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, locale);
  }
}

export async function loadCatalog(locale: SupportedLocale): Promise<void> {
  const { messages } = await import(`../locales/${locale}/messages.po`);
  i18n.load(locale, messages);
  i18n.activate(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

export { i18n };
