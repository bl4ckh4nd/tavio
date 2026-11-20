
import React, { useEffect, useRef } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import { 
  Bold, Italic, Strikethrough, List, ListOrdered, 
  Heading1, Heading2, Quote, Undo, Redo, X, Download,
  Lock, LockOpen, FileText, Maximize2, Minimize2
} from 'lucide-react';
import { IconButton, Stamp, Tag } from './ui';
import { User, UserRole } from '../types';
import { toSessionDay } from './sessions/format';
import { ensureSessionMark, SESSION_MARK_META, SessionMark } from './sessions/sessionMark';
import { ASSISTANT_META, AssistantBlocks, assistantBlockIds, syncAssistantBlocks, type AssistantBlock } from './sessions/assistantBlocks';

interface MeetingDocProps {
  onClose: () => void;
  initialContent?: string;
  /** The notes as HTML, and the assistant's blocks this editor has shown (see syncAssistantBlocks). */
  onUpdate: (content: string, seenAssistantIds: string[], base: string | null) => string | null;
  contentRevision?: string | null;
  hasDraft?: boolean;
  /** When the notes in initialContent were last changed. */
  contentChangedAt?: number | null;
  /** What the meeting assistant wrote into the notes lately, and what was undone. */
  assistantBlocks?: AssistantBlock[];
  currentUser: User;
  isLocked: boolean;
  onToggleLock: () => void;
  darkMode?: boolean;
  mode?: 'sidebar' | 'fullscreen';
  onToggleExpand?: () => void;
  /** The last save failed: the sheet stops claiming the notes are saved. */
  saveFailed?: boolean;
  /** When the running session began. The first edit of a session puts its date line at the top of the notes. */
  sessionStartedAt?: number | null;
}

interface MenuButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
  title: string;
}

// html2canvas cannot parse oklch(), which every token is, and a PDF prints black on white in both modes.
// The copy it renders also sits outside the sheet, so it brings its own heading and quote styles.
const PDF_STYLES = `*, *::before, *::after {
  color: #1c1917 !important;
  background-color: transparent !important;
  background-image: none !important;
  border-color: #d6d3d1 !important;
  outline-color: transparent !important;
  text-decoration-color: currentcolor !important;
  box-shadow: none !important;
  text-shadow: none !important;
}
h1, h2, h3 { font-weight: 600 !important; }
h1 { font-size: 24px !important; }
h2 { font-size: 20px !important; }
h3 { font-size: 17px !important; }
blockquote { padding-left: 12px !important; border-left: 2px solid #d6d3d1 !important; }`;

const MenuButton = ({
  onClick,
  isActive = false,
  disabled = false,
  children,
  title
}: MenuButtonProps) => (
  <IconButton label={title} onClick={onClick} disabled={disabled} isOn={isActive} aria-pressed={isActive}>
    {children}
  </IconButton>
);

const sheetClasses = (mode: 'sidebar' | 'fullscreen') => mode === 'fullscreen'
  ? 'panel stock stock--lift absolute inset-4 md:inset-10 z-50 entry-pop'
  : 'panel h-full flex-1';

export const MeetingDoc: React.FC<MeetingDocProps> = ({ 
  onClose, 
  initialContent = '', 
  onUpdate,
  currentUser,
  isLocked,
  onToggleLock,
  mode = 'fullscreen',
  onToggleExpand,
  saveFailed = false,
  sessionStartedAt = null,
  contentChangedAt = null,
  contentRevision = null,
  hasDraft = false,
  assistantBlocks,
}) => {
  const sessionDayRef = useRef<string | null>(null);
  const seenAssistantRef = useRef<Set<string>>(new Set());
  const loadedAtRef = useRef(contentChangedAt ?? 0);
  const revisionRef = useRef(contentRevision);
  sessionDayRef.current = sessionStartedAt ? toSessionDay(sessionStartedAt) : null;
  const isHost = currentUser.role === UserRole.HOST;
  const canEdit = isHost || !isLocked;
  const defaultDocContent = `
      <h2>${t`Meeting Notes`}</h2>
      <p>${t`Start typing your agenda, minutes, and action items here...`}</p>
      <ul>
        <li>${t`Review last week's metrics`}</li>
        <li>${t`Discuss upcoming release`}</li>
      </ul>
    `;

  const editor = useEditor({
    extensions: [
      StarterKit,
      SessionMark,
      AssistantBlocks,
    ],
    onCreate: ({ editor }) => {
      for (const id of assistantBlockIds(editor)) seenAssistantRef.current.add(id);
    },
    content: initialContent || defaultDocContent,
    editable: canEdit,
    // The toolbar reads isActive and can() during render, so it has to follow the selection.
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor, transaction }) => {
      // The assistant's blocks are on the server already; saving them here would race every other open editor.
      if (!transaction.docChanged || transaction.getMeta(ASSISTANT_META)) return;
      // Adding the date line is an edit of its own; that second update carries the notes to be saved.
      const day = sessionDayRef.current;
      if (day && !transaction.getMeta(SESSION_MARK_META) && ensureSessionMark(editor, day)) return;
      revisionRef.current = onUpdate(editor.getHTML(), [...seenAssistantRef.current], revisionRef.current);
    },
    editorProps: {
      attributes: {
        class: 'doc',
      },
    },
  });

  useEffect(() => {
    if (!editor || hasDraft || revisionRef.current === contentRevision) return;
    revisionRef.current = contentRevision;
    loadedAtRef.current = contentChangedAt ?? 0;
    editor.chain().setContent(initialContent, { emitUpdate: false }).setMeta('addToHistory', false).run();
    for (const id of assistantBlockIds(editor)) seenAssistantRef.current.add(id);
  }, [editor, hasDraft, initialContent, contentRevision, contentChangedAt]);

  useEffect(() => {
    if (editor && assistantBlocks) syncAssistantBlocks(editor, assistantBlocks, seenAssistantRef.current, loadedAtRef.current);
  }, [editor, assistantBlocks]);

  // Handle locking/unlocking updates
  useEffect(() => {
    if (editor) {
      editor.setEditable(canEdit, false);
    }
  }, [canEdit, editor]);

  if (!editor) {
    return null;
  }

  const downloadHtml = () => {
    const html = editor.getHTML();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = t`meeting-notes.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToPdf = () => {
    // Select the content area. We use the class added by Tiptap
    const element = document.querySelector('.ProseMirror');
    if (!element) return;

    const opt = {
      margin: 0.5,
      filename: `${t`meeting-notes`}-${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        logging: false,
        useCORS: true,
        onclone: (clone: Document) => {
          const style = clone.createElement('style');
          style.textContent = PDF_STYLES;
          clone.head.appendChild(style);
        },
      },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    // @ts-ignore
    html2pdf().set(opt).from(element).save();
  };

  return (
    <div className={sheetClasses(mode)}>
      {/* Header */}
      <div className="panel__head">
        <h2 className="panel__title"><Trans>Notes</Trans></h2>
        <span className="flex items-center gap-0.5">
          {!canEdit && (
            <Tag className="mr-1">
              <Lock className="icon" />
              <Trans>Read-only</Trans>
            </Tag>
          )}

          {isHost && (
            <IconButton
              label={isLocked ? t`Unlock for everyone` : t`Lock editing (Host only)`}
              onClick={onToggleLock}
              isOn={isLocked}
              aria-pressed={isLocked}
            >
              {isLocked ? <Lock className="icon" /> : <LockOpen className="icon" />}
            </IconButton>
          )}

          {mode === 'fullscreen' && (
            <>
              <IconButton label={t`Download HTML`} onClick={downloadHtml}>
                <Download className="icon" />
              </IconButton>
              <IconButton label={t`Export PDF`} onClick={exportToPdf}>
                <FileText className="icon" />
              </IconButton>
            </>
          )}

          {onToggleExpand && (
            <IconButton label={mode === 'fullscreen' ? t`Collapse to sidebar` : t`Expand to fullscreen`} onClick={onToggleExpand}>
              {mode === 'fullscreen' ? <Minimize2 className="icon" /> : <Maximize2 className="icon" />}
            </IconButton>
          )}

          <IconButton label={t`Close notes`} onClick={onClose}>
            <X className="icon" />
          </IconButton>
        </span>
      </div>

      {/* Toolbar */}
      {canEdit && (
        <div className="fmt flex-wrap">
          <MenuButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            title={t`Bold`}
          >
            <Bold className="icon" />
          </MenuButton>
          <MenuButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            title={t`Italic`}
          >
            <Italic className="icon" />
          </MenuButton>
          <MenuButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive('strike')}
            title={t`Strikethrough`}
          >
            <Strikethrough className="icon" />
          </MenuButton>

          <span className="fmt__sep" />

          <MenuButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor.isActive('heading', { level: 1 })}
            title={t`Heading 1`}
          >
            <Heading1 className="icon" />
          </MenuButton>
          <MenuButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive('heading', { level: 2 })}
            title={t`Heading 2`}
          >
            <Heading2 className="icon" />
          </MenuButton>

          <span className="fmt__sep" />

          <MenuButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
            title={t`Bullet List`}
          >
            <List className="icon" />
          </MenuButton>
          <MenuButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive('orderedList')}
            title={t`Ordered List`}
          >
            <ListOrdered className="icon" />
          </MenuButton>

          {mode === 'fullscreen' && (
            <>
              <span className="fmt__sep" />
              <MenuButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                isActive={editor.isActive('blockquote')}
                title={t`Quote`}
              >
                <Quote className="icon" />
              </MenuButton>
              <MenuButton
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                title={t`Undo`}
              >
                <Undo className="icon" />
              </MenuButton>
              <MenuButton
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                title={t`Redo`}
              >
                <Redo className="icon" />
              </MenuButton>
            </>
          )}
        </div>
      )}

      {/* Editor Content */}
      <div
        className={`panel__body ${canEdit ? 'cursor-text' : ''}`}
        onClick={() => canEdit && editor.chain().focus().run()}
      >
        <EditorContent editor={editor} className="mdoc" />
      </div>

      {!saveFailed && (
        <div className="panel__foot">
          <Stamp size="s"><Trans>Saved in this room</Trans></Stamp>
        </div>
      )}
    </div>
  );
};
