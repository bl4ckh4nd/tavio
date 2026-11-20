import { useSyncExternalStore } from 'react';

// public/color-mode.js reads the same key to set .dark before the first paint.
const STORAGE_KEY = 'tavio-dark-mode';
const listeners = new Set<() => void>();

const readStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

let darkMode = typeof window !== 'undefined' && readStored();

const setDarkMode = (next: boolean) => {
  darkMode = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // The choice still holds for this page.
  }
  document.documentElement.classList.toggle('dark', next);
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useColorMode = () => ({
  darkMode: useSyncExternalStore(subscribe, () => darkMode, () => false),
  setDarkMode,
  toggleDarkMode: () => setDarkMode(!darkMode),
});
