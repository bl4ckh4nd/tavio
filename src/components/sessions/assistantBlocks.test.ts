import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ASSISTANT_META, AssistantBlocks, assistantBlockIds, syncAssistantBlocks } from './assistantBlocks';

let editor: Editor | null = null;
let saves = 0;
const makeEditor = (content: string) => {
  saves = 0;
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, AssistantBlocks],
    content,
    onUpdate: ({ transaction }) => { if (!transaction.getMeta(ASSISTANT_META)) saves += 1; },
  });
  return editor;
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const block = (blockId: string, createdAt: number, undone = false) => ({
  blockId,
  createdAt,
  undone,
  html: `<h3 data-assistant="${blockId}">Aufgaben</h3><ul data-assistant="${blockId}"><li><p>Neu</p></li></ul>`,
});

describe('what the assistant writes into an open editor', () => {
  it('keeps its marker through a reload of the saved notes', () => {
    const e = makeEditor('<p>Agenda</p><ul data-assistant="b1"><li><p>x</p></li></ul>');
    expect(e.getHTML()).toBe('<p>Agenda</p><ul data-assistant="b1"><li><p>x</p></li></ul>');
    expect([...assistantBlockIds(e)]).toEqual(['b1']);
  });

  it('appears at the end without being saved or undone from here', () => {
    const e = makeEditor('<p>Agenda</p>');
    const seen = new Set<string>();
    syncAssistantBlocks(e, [block('b1', 200)], seen, 100);

    // The editor keeps an empty line after a list at the end, to write on.
    expect(e.getHTML()).toBe('<p>Agenda</p><h3 data-assistant="b1">Aufgaben</h3><ul data-assistant="b1"><li><p>Neu</p></li></ul><p></p>');
    expect(saves).toBe(0);
    expect(seen.has('b1')).toBe(true);
    // The person's own undo does not take the assistant's block away.
    e.commands.undo();
    expect(assistantBlockIds(e).has('b1')).toBe(true);
  });

  it('is added once, however often the list arrives', () => {
    const e = makeEditor('<p>Agenda</p>');
    const seen = new Set<string>();
    syncAssistantBlocks(e, [block('b1', 200)], seen, 100);
    syncAssistantBlocks(e, [block('b1', 200)], seen, 100);
    expect(e.getHTML().match(/<h3/g)).toHaveLength(1);
  });

  it('does not come back when it was deleted before these notes were loaded', () => {
    const e = makeEditor('<p>Agenda</p>');
    const seen = new Set<string>();
    syncAssistantBlocks(e, [block('b1', 50)], seen, 100);
    expect(e.getHTML()).toBe('<p>Agenda</p>');
    expect(seen.has('b1')).toBe(true);
  });

  it('goes away on undo, without a save from here', () => {
    const e = makeEditor('<p>Agenda</p><h3 data-assistant="b1">Aufgaben</h3><ul data-assistant="b1"><li><p>Neu</p></li></ul><p>Danach</p>');
    syncAssistantBlocks(e, [block('b1', 200, true)], new Set(['b1']), 100);
    expect(e.getHTML()).toBe('<p>Agenda</p><p>Danach</p>');
    expect(saves).toBe(0);
  });

  it('finds and takes away a block someone turned into a quote', () => {
    const e = makeEditor('<p>Agenda</p><blockquote><p data-assistant="b1">Neu</p></blockquote><p>Danach</p>');
    expect([...assistantBlockIds(e)]).toEqual(['b1']);
    syncAssistantBlocks(e, [{ ...block('b1', 200, true), html: '<p data-assistant="b1">Neu</p>' }], new Set(['b1']), 100);
    expect(e.getHTML()).toBe('<p>Agenda</p><p>Danach</p>');
  });

  it('takes away a quote that held only its block, and only its item from a list that has others', () => {
    const quoted = makeEditor('<p>Agenda</p><blockquote><h3 data-assistant="b1">Aufgaben</h3><ul data-assistant="b1"><li><p>Neu</p></li></ul></blockquote><p>Danach</p>');
    syncAssistantBlocks(quoted, [block('b1', 200, true)], new Set(['b1']), 100);
    expect(quoted.getHTML()).toBe('<p>Agenda</p><p>Danach</p>');
    quoted.destroy();

    const listed = makeEditor('<ul><li><p>Mein Punkt</p></li><li><p data-assistant="b2">Neu</p></li></ul>');
    syncAssistantBlocks(listed, [{ ...block('b2', 200, true), html: '<p data-assistant="b2">Neu</p>' }], new Set(['b2']), 100);
    // The editor keeps an empty line after a list at the end, to write on.
    expect(listed.getHTML()).toBe('<ul><li><p>Mein Punkt</p></li></ul><p></p>');
  });
});
