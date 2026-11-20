import React from "react";
import { useLingui } from "@lingui/react";
import { ChevronDown, Globe } from "lucide-react";
import { Select } from "./ui";
import {
  SUPPORTED_LOCALES,
  LOCALE_NAMES,
  loadCatalog,
  persistLocale,
  type SupportedLocale,
} from "../lib/i18n";

// "quiet" is the word in a top bar and takes its colour from there; "field" is the settings form's select.
export const LanguageSwitcher: React.FC<{
  className?: string;
  variant?: "quiet" | "field";
}> = ({ className = "", variant = "quiet" }) => {
  const { i18n } = useLingui();
  const currentLocale = i18n.locale as SupportedLocale;

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLocale = e.target.value as SupportedLocale;
    await loadCatalog(newLocale);
    persistLocale(newLocale);
  };

  const label = i18n._({ id: "language_switcher_label", message: "Language" });

  if (variant === "field") {
    return (
      <Select
        value={currentLocale}
        onChange={handleChange}
        aria-label={label}
        className={className}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <div className={`relative inline-flex items-center hover:text-ink ${className}`}>
      <Globe className="icon pointer-events-none absolute left-0" aria-hidden="true" />
      <select
        value={currentLocale}
        onChange={handleChange}
        aria-label={label}
        className="min-h-8 cursor-pointer appearance-none rounded-input border-0 bg-transparent px-5 text-sm text-inherit [field-sizing:content] pointer-coarse:min-h-11"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale} className="bg-cotton text-print">
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
      <ChevronDown className="icon pointer-events-none absolute right-0" aria-hidden="true" />
    </div>
  );
};
