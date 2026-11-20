import { Node, type Editor } from '@tiptap/core';
import { SESSION_DAY, formatSessionDay } from './format';

/**
 * The date line a session leaves in the notes. It is saved as <h6>2026-11-05</h6>, because the
 * server keeps tags and drops attributes, and shown in the reader's own date format.
 * It is one block of its own: select it and delete it like any line.
 */
export const SessionMark = Node.create({
  name: 'sessionMark',
  group: 'block',
  atom: true,
  selectable: true,
  // Ahead of the heading rule, which would otherwise read the line as a level-six heading.
  priority: 1000,

  addAttributes() {
    return { day: { default: '' } };
  },

  parseHTML() {
    return [{
      tag: 'h6',
      getAttrs: (element) => {
        const day = (element as HTMLElement).textContent?.trim() ?? '';
        return SESSION_DAY.test(day) ? { day } : false;
      },
    }];
  },

  renderHTML({ node }) {
    return ['h6', {}, node.attrs.day as string];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('h6');
      dom.contentEditable = 'false';
      dom.textContent = formatSessionDay(node.attrs.day as string);
      return { dom };
    };
  },
});

export const SESSION_MARK_META = 'sessionMark';

const hasSessionMark = (editor: Editor, day: string) => {
  let found = false;
  editor.state.doc.forEach((node) => {
    if (node.type.name === SessionMark.name && node.attrs.day === day) found = true;
  });
  return found;
};

/**
 * Puts the day's line at the top of the notes, under a title if there is one, with an empty line to write on.
 * Does nothing when the day already has its line. Returns whether it changed the document.
 */
export const ensureSessionMark = (editor: Editor, day: string) => {
  if (!SESSION_DAY.test(day) || hasSessionMark(editor, day)) return false;
  const { schema, doc } = editor.state;
  const first = doc.firstChild;
  const position = first && first.type.name === 'heading' ? first.nodeSize : 0;
  return editor.chain().command(({ tr }) => {
    tr.insert(position, [schema.nodes[SessionMark.name].create({ day }), schema.nodes.paragraph.create()]);
    tr.setMeta(SESSION_MARK_META, true);
    return true;
  }).run();
};
