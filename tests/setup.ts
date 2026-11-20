import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Vitest does not run the Lingui macro transform, so the core macros resolve
// to source strings here. Tests needing other behavior can still vi.mock locally.
const joinTemplate = (strings: TemplateStringsArray, ...values: unknown[]) =>
  strings.reduce((acc, part, idx) => `${acc}${part}${values[idx] ?? ''}`, '');
vi.mock('@lingui/core/macro', () => ({
  t: joinTemplate,
  msg: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const message = joinTemplate(strings, ...values);
    return { id: message, message };
  },
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(window as any).ResizeObserver = ResizeObserverMock;
window.scrollTo = () => {};

if (!globalThis.crypto) {
  // @ts-expect-error test shim
  globalThis.crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000000';
}
