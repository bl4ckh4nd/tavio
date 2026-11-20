import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';

const locale = () => i18n.locale || undefined;

/** 05.11.2026: the short date that names a board or a session. */
export const formatShortDate = (timestamp: number) =>
  new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(timestamp));

/** A task's due day (YYYY-MM-DD), short: 20. Nov. */
export const formatDueDate = (due: string) =>
  new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(new Date(`${due}T12:00:00`));

/** 5. November 2026 */
export const formatLongDate = (timestamp: number) =>
  new Intl.DateTimeFormat(locale(), { dateStyle: 'long' }).format(new Date(timestamp));

export const formatClock = (timestamp: number) =>
  new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));

const isSameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** "Today, 09:30" or "05.11.2026, 09:30": the line where a session starts. */
export const formatSessionStart = (timestamp: number, now = Date.now()) =>
  `${isSameDay(timestamp, now) ? t`Today` : formatShortDate(timestamp)}, ${formatClock(timestamp)}`;

/** "09:30 to 10:16" */
export const formatClockRange = (from: number, to: number) => {
  const start = formatClock(from);
  const end = formatClock(to);
  return t`${start} to ${end}`;
};

export const formatDurationBetween = (from: number, to: number) => {
  const minutes = Math.max(1, Math.round((to - from) / 60000));
  if (minutes < 60) return t`${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t`${hours} h` : t`${hours} h ${rest} min`;
};

/** 2026-11-05 in the viewer's own time zone: how a session's day is written into the notes. */
export const toSessionDay = (timestamp: number) => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const SESSION_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const formatSessionDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return formatShortDate(new Date(year, month - 1, date).getTime());
};

/** Saved notes hold a session's day as written by the editor; a reader gets it in their own date format. */
export const localizeSessionMarks = (html: string) =>
  html.replace(/<h6>\s*(\d{4}-\d{2}-\d{2})\s*<\/h6>/g, (_all, day: string) => `<h6>${formatSessionDay(day)}</h6>`);
