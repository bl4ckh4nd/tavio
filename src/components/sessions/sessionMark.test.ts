import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { localizeSessionMarks, toSessionDay } from './format';
import { ensureSessionMark, SessionMark } from './sessionMark';

let editor: Editor | null = null;
const makeEditor = (content: string) => {
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, SessionMark], content });
  return editor;
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('the date line a session leaves in the notes', () => {
  it('goes under the title, with an empty line to write on', () => {
    const e = makeEditor('<h2>Notes</h2><p>Old</p>');
    expect(ensureSessionMark(e, '2026-11-12')).toBe(true);
    expect(e.getHTML()).toBe('<h2>Notes</h2><h6>2026-11-12</h6><p></p><p>Old</p>');
  });

  it('goes to the very top when the notes have no title', () => {
    const e = makeEditor('<p>Old</p>');
    ensureSessionMark(e, '2026-11-12');
    expect(e.getHTML()).toBe('<h6>2026-11-12</h6><p></p><p>Old</p>');
  });

  it('is added once per day and survives a reload of the saved notes', () => {
    const e = makeEditor('<h2>Notes</h2><h6>2026-11-05</h6><p>Old</p>');
    expect(e.state.doc.child(1).type.name).toBe('sessionMark');
    expect(ensureSessionMark(e, '2026-11-05')).toBe(false);
    expect(ensureSessionMark(e, '2026-11-12')).toBe(true);
    expect(e.getHTML()).toBe('<h2>Notes</h2><h6>2026-11-12</h6><p></p><h6>2026-11-05</h6><p>Old</p>');
  });

  it('leaves an ordinary level-six heading alone', () => {
    const e = makeEditor('<h6>Small print</h6>');
    expect(e.state.doc.child(0).type.name).toBe('heading');
  });

  it('shows the day in the reader\'s date format', () => {
    const e = makeEditor('<h6>2026-11-05</h6>');
    const shown = e.view.dom.querySelector('h6')?.textContent ?? '';
    expect(shown).not.toBe('2026-11-05');
    expect(shown).toMatch(/2026/);
    expect(localizeSessionMarks('<h2>N</h2><h6>2026-11-05</h6><p>x</p>')).toBe(`<h2>N</h2><h6>${shown}</h6><p>x</p>`);
  });

  it('writes a session\'s day in local time', () => {
    expect(toSessionDay(new Date(2026, 10, 5, 23, 30).getTime())).toBe('2026-11-05');
  });
});
