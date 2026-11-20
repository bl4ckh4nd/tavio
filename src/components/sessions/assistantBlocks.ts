import { Extension, type Editor } from '@tiptap/core';
type PMNode = Editor['state']['doc'];

/**
 * The blocks the meeting assistant writes carry data-assistant="<block id>", so an undo can find them.
 * The server keeps that one attribute; this extension keeps it in the editor.
 */
export const AssistantBlocks = Extension.create({
  name: 'assistantBlocks',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote'],
      attributes: {
        assistant: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-assistant'),
          renderHTML: (attrs) => (attrs.assistant ? { 'data-assistant': attrs.assistant } : {}),
        },
      },
    }];
  },
});

/** A change the assistant made arrives from outside: it is not this editor's edit, so it is neither saved nor undoable here. */
export const ASSISTANT_META = 'assistantBlock';

export type AssistantBlock = { blockId: string; html: string; createdAt: number; undone: boolean };

/** Someone may have turned the block into a quote or a list item since, so it can sit deeper than the top level. */
const markedBlocks = (editor: Editor) => {
  const found: Array<{ blockId: string; pos: number; size: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.attrs.assistant) return true;
    found.push({ blockId: node.attrs.assistant as string, pos, size: node.nodeSize });
    return false;
  });
  return found;
};

export const assistantBlockIds = (editor: Editor) => new Set(markedBlocks(editor).map(block => block.blockId));

const insertBlock = (editor: Editor, html: string) =>
  editor.chain()
    .insertContentAt(editor.state.doc.content.size, html)
    .setMeta(ASSISTANT_META, true)
    .setMeta('addToHistory', false)
    .run();

/** The block, or a quote, list or list item that held nothing but the block. */
const holdsOnly = (node: PMNode, blockId: string): boolean =>
  node.attrs.assistant === blockId ||
  (!node.isTextblock && node.childCount > 0 && node.children.every(child => holdsOnly(child, blockId)));

const removeBlock = (editor: Editor, blockId: string) => {
  const ranges: Array<{ from: number; to: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!holdsOnly(node, blockId)) return true;
    ranges.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  if (ranges.length === 0) return;
  const tr = editor.state.tr;
  for (const { from, to } of ranges.reverse()) tr.delete(from, to);
  tr.setMeta(ASSISTANT_META, true).setMeta('addToHistory', false);
  editor.view.dispatch(tr);
};

/**
 * Brings the assistant's blocks into an open editor. `seen` holds every block this editor has shown;
 * the save sends it, so the server can tell a block someone deleted from one this editor never had.
 * `loadedAt` is when the notes the editor opened with were last changed: a block written after that
 * is new here, one written before it and missing was deleted by someone.
 */
export const syncAssistantBlocks = (editor: Editor, blocks: AssistantBlock[], seen: Set<string>, loadedAt: number) => {
  const present = assistantBlockIds(editor);
  for (const block of [...blocks].sort((a, b) => a.createdAt - b.createdAt)) {
    if (block.undone) {
      if (present.has(block.blockId)) removeBlock(editor, block.blockId);
      continue;
    }
    if (seen.has(block.blockId)) continue;
    seen.add(block.blockId);
    if (!present.has(block.blockId) && block.createdAt > loadedAt) insertBlock(editor, block.html);
  }
};
