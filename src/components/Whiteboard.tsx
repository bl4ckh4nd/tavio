import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  PenTool, Eraser, Trash2, Download, Plus, MousePointer2, ZoomIn, ZoomOut, Hand, X,
  Square, Circle, Diamond, MoveUpRight, Minus, Type, Undo, Redo, Grid3x3, SlidersHorizontal,
  StickyNote, Frame, Stamp, CornerDownRight, LayoutPanelTop, FileCode, Shapes, LayoutTemplate, SquareCheck, Highlighter, Table2, Network,
} from 'lucide-react';
import { WHITEBOARD_MORE_SHAPES, WHITEBOARD_STAMPS, type WhiteboardElement, type WhiteboardHtml, type WhiteboardMoreShape, type WhiteboardPoint, type WhiteboardStampKind } from '../types';
import { IconButton } from './ui';
import { BoardSvg } from './sessions/BoardThumb';
import {
  boundsOfAll, elementBounds, hitTest, linePath, outlinePath, rectsTouch, resizeElement, SECTION_TAB_HEIGHT, SECTION_TAB_MAX_WIDTH, tableCellAt, tableCellBox, touchedByPath, type Rect,
} from './whiteboard/geometry';
import {
  addMindmapNode, align, bindEnd, bindingAt, boardSignature, connectNew, distribute, fromTemplate, type TemplateColumn, duplicate, followBindings, group, layoutMindmap,
  MINDMAP_NODE, moveSelection, newId, nextCell, nextNote, rebaseWriting, reorder, resizeTable, restyle, snapAngle, TABLE_LIMITS, ungroup, withGroups, writeElement,
  type Side, type StylePatch,
} from './whiteboard/operations';
import {
  drawElement, drawMindmapLinks, fitNoteText, lineHeightFor, measureText, midpointOf, MINDMAP_FONT_SIZE, MINDMAP_PADDING, mindmapNodeSize, NOTE_FOOT, NOTE_INSET,
  NOTE_PADDING, PAGE_BAR, personInk, SECTION_FILL_DEFAULT, shapeText, STAMP_GLYPHS, TABLE_FONT_SIZE, TABLE_HEAD_FILL, TABLE_PADDING, TAPE_SIZE, TASK_BOX, TASK_FONT_SIZE,
  TASK_FOOT, TASK_SIZE, TASK_TEXT_X, wrapText, type Paint,
} from './whiteboard/draw';
import type { CursorMessage, LiveCursor } from '../views/meeting/boards/boardCursors';
import { formatDueDate } from './sessions/format';
import {
  hasKinds, kindsOf, kindsOfAll, MARKER_SIZE, MARKERS, NO_KINDS, StylePanel, styleOf, type Kinds, type SelectionActions, type Style,
} from './whiteboard/StylePanel';

type Tool = 'select' | 'hand' | 'pen' | 'marker' | 'note' | 'task' | 'rectangle' | 'diamond' | 'circle' | 'shape' | 'section' | 'arrow' | 'connector' | 'line' | 'text'
  | 'stamp' | 'table' | 'mindmap' | 'eraser';
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_SIZE = 8;
const GRID = 20;
const PASTE_STEP = 24;
const SHAPE_TOOLS: Tool[] = ['rectangle', 'diamond', 'circle', 'shape'];
const LINE_TOOLS: Tool[] = ['arrow', 'connector', 'line'];

/** The note colours of the draft: yellow, green, blue, pink, violet. */
const NOTE_COLORS = ['#fbe7b0', '#d4edd9', '#d6e6fb', '#f9d9d9', '#e6dcf7'];
const NOTE_SIZES = { s: 160, m: 200, l: 280 } as const;
type NoteSize = keyof typeof NOTE_SIZES;
const STAMP_SIZE = 44;
const SECTION_SIZE = { width: 640, height: 420 };
/** How far outside a selected shape its "add the next one" buttons sit, in screen pixels. */
const PLUS_OFFSET = 28;
const PLUS_RADIUS = 11;
const ANCHOR_REACH = 14;
const CHAT_SHOWN_MS = 5000;

const isNote = (el: WhiteboardElement) => el.type === 'shape' && el.shapeType === 'note';
const isTask = (el: WhiteboardElement): el is Extract<WhiteboardElement, { type: 'shape' }> & { shapeType: 'task' } => el.type === 'shape' && el.shapeType === 'task';
const isSection = (el: WhiteboardElement) => el.type === 'shape' && el.shapeType === 'section';
const isTable = (el: WhiteboardElement): el is Extract<WhiteboardElement, { type: 'shape' }> & { shapeType: 'table' } => el.type === 'shape' && el.shapeType === 'table';
const isMindmap = (el: WhiteboardElement): el is Extract<WhiteboardElement, { type: 'shape' }> & { shapeType: 'mindmap' } => el.type === 'shape' && el.shapeType === 'mindmap';
const TABLE_CELL = { width: 140, height: 40 };
/** What a connector can start or end on, and what offers the next shape: a box, but not an area or a stamp. */
const connectable = (el: WhiteboardElement) => (el.type === 'shape' && el.shapeType !== 'section') || el.type === 'text' || el.type === 'image' || el.type === 'html';

const SIDES: { side: Side; fx: number; fy: number; ox: number; oy: number }[] = [
  { side: 'right', fx: 1, fy: 0.5, ox: 1, oy: 0 }, { side: 'below', fx: 0.5, fy: 1, ox: 0, oy: 1 },
  { side: 'left', fx: 0, fy: 0.5, ox: -1, oy: 0 }, { side: 'above', fx: 0.5, fy: 0, ox: 0, oy: -1 },
];

const StampGlyph: React.FC<{ kind: WhiteboardStampKind }> = ({ kind }) => {
  const glyph = STAMP_GLYPHS[kind];
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      {glyph.path
        ? <path d={glyph.path} fill={glyph.fill ? glyph.color : 'none'} stroke={glyph.fill ? 'none' : glyph.color} strokeWidth={glyph.width} strokeLinecap="round" strokeLinejoin="round" />
        : <text x="12" y="13" textAnchor="middle" dominantBaseline="central" fill={glyph.color} fontWeight={700} fontSize={glyph.text!.length > 2 ? 9 : 14}>{glyph.text}</text>}
    </svg>
  );
};

const ShapeGlyph: React.FC<{ kind: WhiteboardMoreShape }> = ({ kind }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path d={outlinePath(kind, { x: 3, y: 4, width: 18, height: 16 })} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
  </svg>
);

/** Canvas cannot resolve var(): read the board's own tokens, which are the same in both modes. */
const readToken = (element: Element, name: string) => getComputedStyle(element).getPropertyValue(name).trim();


// Copies travel between boards, so the clipboard outlives any one whiteboard. The marker written to the
// system clipboard tells a later paste whether these elements are still what the person copied last.
export const PASTE_OFFSET = PASTE_STEP;
let boardClipboard: { marker: string; elements: WhiteboardElement[]; source?: string; pageRoom?: string; pastes: number } | null = null;

/**
 * Copies with new ids and new groups, ready to be added to a board, arrows still bound to copied shapes.
 * On the board they came from they land a step beside the original.
 */
export const copiesForBoard = (items: WhiteboardElement[], offset = 0) =>
  duplicate(items, items.map(el => el.id), offset).elements.slice(items.length);


/** The words on these elements, one element per paragraph: what a copy of them reads as outside the board. */
const boardText = (items: WhiteboardElement[]) =>
  items.flatMap(el => {
    if (el.type === 'text') return [el.text];
    if (el.type === 'shape' && el.text) return [el.text];
    if (el.type === 'line' && el.label) return [el.label];
    if (el.type === 'shape' && el.cells) return [el.cells.map(row => row.join('\t')).join('\n')];
    return [];
  }).join('\n\n');

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

const ToolbarButton: React.FC<{
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
  children: React.ReactNode;
}> = ({ label, onClick, active, disabled, shortcut, children }) => (
  <IconButton label={label} onClick={onClick} disabled={disabled} isOn={active} aria-pressed={active} aria-keyshortcuts={shortcut}>
    {children}
  </IconButton>
);

/**
 * The second argument names what this board has shown and no longer has: what it deleted. Whatever else is
 * on the server and not in the elements, someone (or the assistant) added after this board last heard, and stays.
 */
/** May resolve once nothing this board sent is unsaved any more. */
type EmitElements = (elements: WhiteboardElement[], previous: WhiteboardElement[]) => void | Promise<void>;

/**
 * A view the assistant asked for, or its change brought into sight (reveal moves only when it is out of view).
 * With `by`, a cursor of that name shows for a moment where the change landed.
 */
export type BoardFocus = { key: string; ids: string[]; mode: 'fit' | 'in' | 'out' | 'reveal'; by?: string };

type WhiteboardProps = {
  onClose?: () => void;
  elements?: WhiteboardElement[];
  onCommit?: EmitElements;
  /** A filed board: it can be looked at, selected from and copied, never changed. */
  readOnly?: boolean;
  /** Names the board for copy and paste, so a paste onto the same board lands beside the original. */
  boardSource?: string;
  /** The room whose stored pages the board shows. A page copied in another room cannot be shown here. */
  pageRoom?: string;
  onSelectionChange?: (selected: WhiteboardElement[]) => void;
  /** Offers "New board" in the toolbar. Without it the toolbar keeps "Clear canvas". */
  onNewBoard?: () => void;
  /** What sits on top of the sheet: which board this is, hints, the banner of a filed board. */
  children?: React.ReactNode;
  /** Applied once per key, as soon as the elements it names are here. */
  focus?: BoardFocus;
  /** Stores a pasted image where everyone can load it and returns its address; null when it failed. Without it the image stays on this device. */
  uploadImage?: (image: File) => Promise<string | null>;
  /** The name notes and stamps made here are signed with. */
  me?: string;
  /** Where the others point, in board coordinates. */
  cursors?: Record<string, LiveCursor>;
  /** Where this person points, and what they say there; sent to the others. */
  onCursor?: (message: CursorMessage) => void;
  /** Keeps a page of HTML for everyone and returns its name; null when it failed. Without it no pages can be added. */
  addPage?: (title: string, html: string) => Promise<string | null>;
  /** Shows a page of HTML that is on the board. Without it pages show as their title only. */
  renderPage?: (el: WhiteboardHtml) => React.ReactNode;
  /** A short badge at the top right of an element, by its id: the dots of a vote. */
  marks?: Record<string, string>;
  /** What hangs at an element's bottom left, such as its comments; called for every element, selected or not. */
  renderPin?: (el: WhiteboardElement, selected: boolean) => React.ReactNode;
};

/** Text being written: a new free text at a point, the text of an existing text or shape, a connector's label, or a table's cell. */
type Editing = { id: string | null; kind: 'text' | 'shape' | 'label' | 'cell'; x: number; y: number; value: string; row?: number; col?: number };

type Interaction =
  | { mode: 'none' }
  | { mode: 'pan'; last: WhiteboardPoint }
  | { mode: 'marquee'; from: WhiteboardPoint; to: WhiteboardPoint; adds: boolean }
  | { mode: 'move'; from: WhiteboardPoint; ids: string[]; base: WhiteboardElement[] }
  | { mode: 'resize'; handle: Handle; from: WhiteboardPoint; ids: string[]; base: WhiteboardElement[]; box: Rect }
  | { mode: 'point'; index: number; id: string; base: WhiteboardElement[] }
  | { mode: 'draw'; draft: WhiteboardElement; from: WhiteboardPoint }
  | { mode: 'erase'; path: WhiteboardPoint[]; hits: Set<string> };

const DEFAULT_STYLE: Style = {
  strokeColor: '#18181b', fillColor: 'transparent', strokeWidth: 2, strokeStyle: 'solid', fillStyle: 'solid', roundness: 'round',
  opacity: 1, fontSize: 20, textAlign: 'left', startArrow: false, endArrow: true, markerColor: MARKERS[0],
};

const handlesOf = (b: Rect): { h: Handle; x: number; y: number }[] => [
  { h: 'nw', x: b.x, y: b.y }, { h: 'n', x: b.x + b.width / 2, y: b.y }, { h: 'ne', x: b.x + b.width, y: b.y },
  { h: 'e', x: b.x + b.width, y: b.y + b.height / 2 }, { h: 'se', x: b.x + b.width, y: b.y + b.height },
  { h: 's', x: b.x + b.width / 2, y: b.y + b.height }, { h: 'sw', x: b.x, y: b.y + b.height }, { h: 'w', x: b.x, y: b.y + b.height / 2 },
];
const HANDLE_CURSORS: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

/** The selection box dragged at one handle; Shift keeps its proportions. */
const resizedBox = (box: Rect, handle: Handle, dx: number, dy: number, keepRatio: boolean): Rect => {
  let { x, y, width, height } = box;
  if (handle.includes('e')) width += dx;
  if (handle.includes('w')) { x += dx; width -= dx; }
  if (handle.includes('s')) height += dy;
  if (handle.includes('n')) { y += dy; height -= dy; }
  if (keepRatio && box.width > 0 && box.height > 0) {
    const scale = Math.max(Math.abs(width) / box.width, Math.abs(height) / box.height);
    const w = box.width * scale, h = box.height * scale;
    if (handle.includes('w')) x = box.x + box.width - w;
    if (handle.includes('n')) y = box.y + box.height - h;
    width = w; height = h;
  }
  if (width < 0) { x += width; width = -width; }
  if (height < 0) { y += height; height = -height; }
  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
};

/** Every chosen element scaled from the old selection box into the new one. Text grows with its height. */
const scaleInto = (elements: WhiteboardElement[], ids: string[], from: Rect, to: Rect) => {
  const chosen = new Set(ids);
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  return followBindings(elements.map(el => {
    if (!chosen.has(el.id)) return el;
    const b = elementBounds(el);
    const box = { x: to.x + (b.x - from.x) * sx, y: to.y + (b.y - from.y) * sy, width: b.width * sx, height: b.height * sy };
    if (el.type === 'text') {
      const fontSize = Math.max(8, Math.min(200, el.fontSize * sy));
      return { ...el, x: box.x, y: box.y, fontSize, width: el.width * (fontSize / el.fontSize), height: el.height * (fontSize / el.fontSize) };
    }
    const next = resizeElement(el, box);
    // An arrow scaled with the shapes it joins stays joined.
    return el.type === 'line' && next.type === 'line'
      ? { ...next, start: el.start && chosen.has(el.start.id) ? el.start : undefined, end: el.end && chosen.has(el.end.id) ? el.end : undefined }
      : next;
  }));
};

export const Whiteboard = ({
  onClose, elements: externalElements, onCommit,
  readOnly = false, boardSource, pageRoom, onSelectionChange, onNewBoard, children, focus, uploadImage, me, cursors, onCursor, addPage, renderPage, marks, renderPin,
}: WhiteboardProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  /** A page of HTML taking the pointer, to scroll or select in it; until then it moves like anything else. */
  const [activePage, setActivePage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [history, setHistory] = useState<{ step: number; data: WhiteboardElement[][] }>({ step: 0, data: [externalElements || []] });
  // Like a drawing program, the board opens ready to select; the style card appears with a drawing tool.
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<string[]>([]);
  const [, setImageTick] = useState(0);
  const [camera, setCamera] = useState({ x: 0, y: 0, z: 1 });
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [grid, setGrid] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  // On a narrow board the style card can be put away; it starts out open, so its controls are there when they are needed.
  const [panelOpen, setPanelOpen] = useState(true);
  const toolsRef = useRef<HTMLDivElement>(null);
  /** Below the toolbar, which wraps onto more rows on a narrow board. */
  const [panelTop, setPanelTop] = useState<number | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  const [noteSize, setNoteSize] = useState<NoteSize>('m');
  const [stampKind, setStampKind] = useState<WhiteboardStampKind>('thumb');
  const [moreShape, setMoreShape] = useState<WhiteboardMoreShape>('speech');
  const [shapesOpen, setShapesOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [stampsOpen, setStampsOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  // Cursor chat: what this person is saying at their cursor, while they type and a moment after.
  const [chat, setChat] = useState<{ typing: boolean; text: string } | null>(null);
  const lastPointerRef = useRef<WhiteboardPoint | null>(null);
  const hoverRef = useRef<string | null>(null);
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  // Bumps a render while a pointer interaction changes what is drawn.
  const [, setFrame] = useState(0);

  const interactionRef = useRef<Interaction>({ mode: 'none' });
  // Counts finished pointer interactions, so a remote state held back during one is taken in when it ends.
  const [settled, setSettled] = useState(0);
  const spaceRef = useRef(false);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastExternalSignatureRef = useRef<string>('');
  // States this board sent whose saves are not all confirmed yet. One of them coming back is an echo of our own
  // save, not someone else's change. Once everything is saved, the server already shows it: what comes after is theirs.
  const sentRef = useRef<{ signature: string; items: WhiteboardElement[] }[]>([]);
  const remember = (items: WhiteboardElement[]) => {
    const entry = { signature: boardSignature(items), items };
    sentRef.current = [...sentRef.current.slice(-19), entry];
    return entry;
  };
  const sentAs = (signature: string) => sentRef.current.find(s => s.signature === signature)?.items;
  const missedRef = useRef<WhiteboardElement[] | null>(null);
  const commitBaseRef = useRef<WhiteboardElement[] | undefined>(undefined);

  const elements = history.data[history.step];
  // An image upload finishes after the board may have changed; it adds to what is there then.
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  // The state the parent already has: what it handed in, or what was last emitted to it.
  const knownOutsideRef = useRef(elements);
  /** The last state the server is known to have: taken in from it, or sent and come back. Changes made here are measured against it. */
  const confirmedRef = useRef(elements);
  const canUndo = history.step > 0;
  const canRedo = history.step < history.data.length - 1;
  const byId = useMemo(() => new Map(elements.map(el => [el.id, el])), [elements]);
  const selected = useMemo(() => selection.map(id => byId.get(id)).filter((el): el is WhiteboardElement => !!el), [selection, byId]);

  // --- Changes ---

  /** A new state of the board, saved for everyone. */
  const commit = useCallback((next: WhiteboardElement[], base?: WhiteboardElement[]) => {
    commitBaseRef.current = base;
    setHistory(prev => {
      const data = base && base !== prev.data[prev.step] ? [base] : prev.data.slice(0, prev.step + 1);
      if (data[data.length - 1] === next) return { data, step: data.length - 1 };
      data.push(next);
      return { data, step: data.length - 1 };
    });
  }, []);

  const deleteIds = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    if (gone.size === 0) return;
    commit(followBindings(elements.filter(el => !gone.has(el.id))));
    setSelection(prev => prev.filter(id => !gone.has(id)));
  }, [commit, elements]);

  const unlockedSelection = selected.filter(el => !el.locked).map(el => el.id);
  const deleteSelected = useCallback(() => { if (!readOnly) deleteIds(unlockedSelection); }, [readOnly, deleteIds, unlockedSelection]);

  const undo = useCallback(() => {
    setHistory(prev => ({ ...prev, step: Math.max(0, prev.step - 1) }));
  }, []);
  const redo = useCallback(() => {
    setHistory(prev => ({ ...prev, step: Math.min(prev.data.length - 1, prev.step + 1) }));
  }, []);

  // A selection outlives undo and remote changes as long as its elements are still there.
  useEffect(() => {
    if (selection.some(id => !byId.has(id))) setSelection(prev => prev.filter(id => byId.has(id)));
  }, [byId, selection]);

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => { onSelectionChangeRef.current?.(selected); }, [selected]);

  // Sync external elements into local state only when remote data actually changed.
  useEffect(() => {
    if (!externalElements) return;
    const incomingSignature = boardSignature(externalElements);
    if (incomingSignature === lastExternalSignatureRef.current) return;
    // Avoid clobbering active edits while pointer interactions or typing are in progress.
    if (interactionRef.current.mode !== 'none' || editing) {
      // Kept for when the writing ends: it is written onto this newer state. Our own save coming back is not newer.
      const sent = sentAs(incomingSignature);
      if (sent) confirmedRef.current = sent;
      else if (incomingSignature === boardSignature(elements)) confirmedRef.current = elements;
      else if (editing) missedRef.current = externalElements;
      return;
    }
    missedRef.current = null;
    // A change made here in this same pass is not sent yet. Taking in the older state now would drop it;
    // its save comes back from the server with what others did meanwhile, and that is taken in then.
    if (elements !== knownOutsideRef.current) {
      lastExternalSignatureRef.current = incomingSignature;
      return;
    }
    // An older save of ours arriving after newer changes here must not undo them; their own save is on its way.
    const sent = sentAs(incomingSignature);
    if (sent) confirmedRef.current = sent;
    const ownEcho = !!sent;
    if (!ownEcho && incomingSignature !== boardSignature(elements)) {
      knownOutsideRef.current = externalElements;
      confirmedRef.current = externalElements;
      setHistory({ step: 0, data: [externalElements] });
    } else if (!ownEcho) confirmedRef.current = elements;
    lastExternalSignatureRef.current = incomingSignature;
  }, [externalElements, elements, editing, settled]);

  // A snapshot taken in from the server already has knownOutsideRef set to it.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  useEffect(() => {
    if (elements === knownOutsideRef.current) return;
    const previous = commitBaseRef.current ?? knownOutsideRef.current;
    commitBaseRef.current = undefined;
    knownOutsideRef.current = elements;
    if (!onCommitRef.current || previous === elements) return;
    const entry = remember(elements);
    void onCommitRef.current(elements, previous)?.then(() => {
      sentRef.current = sentRef.current.slice(sentRef.current.indexOf(entry) + 1);
    });
  }, [elements]);

  // --- Style ---

  /** What the next element of the current tool can be styled with, by the same table the selection uses. */
  const toolKinds = (): Kinds => {
    const any = { id: '', x: 0, y: 0, width: 0, height: 0, strokeColor: '', fillColor: '', strokeWidth: 0 };
    if (tool === 'pen' || tool === 'marker') return kindsOf({ id: '', type: 'stroke', tool, color: '', size: 0, points: [] });
    if (LINE_TOOLS.includes(tool)) return { ...kindsOf({ id: '', type: 'line', points: [], strokeColor: '', strokeWidth: 0 }), arrows: tool !== 'line' };
    if (tool === 'text') return kindsOf({ ...any, type: 'text', text: '', color: '', fontSize: 0 });
    if (SHAPE_TOOLS.includes(tool)) {
      // Words come later, once the shape is there; the card then offers their size and alignment.
      const shapeType = tool === 'shape' ? moreShape : tool as 'rectangle' | 'diamond' | 'circle';
      return { ...kindsOf({ ...any, type: 'shape', shapeType }), text: false };
    }
    if (tool === 'table' || tool === 'mindmap') return { ...kindsOf({ ...any, type: 'shape', shapeType: tool }), text: false };
    // Notes, task cards, sections and stamps bring their own look; the eraser and the hand draw nothing.
    return NO_KINDS;
  };
  const shownStyle = selected.length > 0 ? styleOf(selected[0], style) : style;

  /** The text boxes of these elements measured anew, after their size changed: free text, and mind map nodes (their maps laid out again). */
  const remeasure = (items: WhiteboardElement[], ids: string[]) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return items;
    const { font } = paintFor(canvas);
    const chosen = new Set(ids);
    let next = items.map(el => {
      if (!chosen.has(el.id)) return el;
      if (el.type === 'text') return { ...el, ...measureText(ctx, el.text, el.fontSize, font) };
      if (el.type !== 'shape') return el;
      if (el.shapeType === 'mindmap') return { ...el, ...nodeSize(ctx, el.text ?? '', el.fontSize ?? MINDMAP_FONT_SIZE, font, !el.parent) };
      // A shape grows down to hold its words; it never shrinks on its own.
      if (el.text && kindsOf(el).hatch) {
        const look = shapeText(el, { ink: '' });
        ctx.font = `${look.weight} ${look.fontSize}px ${font}`;
        const b = elementBounds(el);
        const needed = wrapText(ctx, el.text, b.width - 2 * NOTE_PADDING).length * lineHeightFor(look.fontSize) + 2 * NOTE_PADDING;
        return needed > b.height ? { ...el, y: b.y, height: needed } : el;
      }
      return el;
    });
    for (const el of next) if (chosen.has(el.id) && isMindmap(el)) next = layoutMindmap(next, el.id);
    return followBindings(next);
  };

  const applyStyle = (patch: StylePatch) => {
    setStyle(prev => ({ ...prev, ...patch }) as Style);
    if (readOnly || unlockedSelection.length === 0) return;
    let next = restyle(elements, unlockedSelection, patch);
    // A text's box, and a mind map node's, follow their new size.
    if (patch.fontSize !== undefined) next = remeasure(next, unlockedSelection);
    commit(next);
  };

  const unitCount = new Set(selected.map(el => el.groupId ?? el.id)).size;
  const selectionActions: SelectionActions | undefined = selected.length > 0 && !readOnly ? {
    units: unitCount,
    canGroup: unitCount > 1,
    canUngroup: selected.some(el => el.groupId),
    locked: selected.every(el => el.locked),
    onOrder: where => commit(reorder(elements, unlockedSelection, where)),
    onAlign: edge => commit(align(elements, unlockedSelection, edge)),
    onDistribute: axis => commit(distribute(elements, unlockedSelection, axis)),
    onDuplicate: () => {
      const { elements: next, added } = duplicate(elements, unlockedSelection, PASTE_STEP);
      commit(next);
      setSelection(added);
    },
    onGroup: () => commit(group(elements, unlockedSelection)),
    onUngroup: () => commit(ungroup(elements, unlockedSelection)),
    onLock: locked => {
      const ids = new Set(selection);
      commit(elements.map(el => (ids.has(el.id) ? { ...el, locked: locked || undefined } : el)));
    },
    onDelete: deleteSelected,
  } : undefined;

  // --- Text ---

  const paintFor = (canvas: HTMLCanvasElement): Paint => ({
    board: readToken(canvas, '--color-whiteboard'),
    // Notes are written in ink on the light board, in both modes.
    ink: readToken(canvas, '--ink-black') || '#18181b',
    dueLabel: formatDueDate,
    font: readToken(canvas, '--font-display') || 'sans-serif',
    images: imageCache.current,
  });

  /** The box a mind map node needs for its words. */
  const nodeSize = (ctx: CanvasRenderingContext2D, text: string, fontSize: number, font: string, root: boolean) =>
    mindmapNodeSize(text, fontSize, run => {
      ctx.font = `${root ? 600 : 500} ${fontSize}px ${font}`;
      return ctx.measureText(run).width;
    });

  const startEditing = (el: WhiteboardElement | null, at?: WhiteboardPoint, cell?: { row: number; col: number }) => {
    if (readOnly) return;
    if (el && isTable(el)) {
      const { row, col } = cell ?? { row: 0, col: 0 };
      const b = tableCellBox(el, row, col);
      setEditing({ id: el.id, kind: 'cell', x: b.x, y: b.y, value: el.cells?.[row]?.[col] ?? '', row, col });
      setSelection([el.id]);
      return;
    }
    if (el?.type === 'text') setEditing({ id: el.id, kind: 'text', x: el.x, y: el.y, value: el.text });
    else if (el?.type === 'line') {
      const at = midpointOf(linePath(el));
      setEditing({ id: el.id, kind: 'label', x: at.x, y: at.y, value: el.label ?? '' });
    } else if (el?.type === 'shape') {
      const b = elementBounds(el);
      setEditing({ id: el.id, kind: 'shape', x: b.x, y: b.y, value: el.text ?? '' });
    } else if (at) setEditing({ id: null, kind: 'text', x: at.x, y: at.y, value: '' });
    setSelection(el ? [el.id] : []);
  };

  const writingBase = () => rebaseWriting(elements, confirmedRef.current, missedRef.current);
  const writeInto = (base: WhiteboardElement[], el: WhiteboardElement, patch: Partial<WhiteboardElement>) =>
    writeElement(base, el, patch, confirmedRef.current);

  /**
   * The board with a shape's new text in it; the same array when nothing changed. A mind map node takes the
   * size its words need, and its map is laid out again.
   */
  const withShapeText = (edit: Editing, value: string, base: WhiteboardElement[]) => {
    const el = edit.id ? byId.get(edit.id) : undefined;
    if (el?.type !== 'shape' || ((el.text ?? '') === value && base === elements)) return base;
    return remeasure(writeInto(base, el, { text: value ? value.slice(0, 500) : undefined }), [el.id]);
  };

  /** The board with a table cell's new text in it; the same array when nothing changed. */
  const withCellText = (edit: Editing, value: string, base: WhiteboardElement[]) => {
    const el = edit.id ? base.find(e => e.id === edit.id) ?? byId.get(edit.id) : undefined;
    if (!el || !isTable(el) || edit.row === undefined || edit.col === undefined) return base;
    const cells = el.cells ?? [['']];
    if ((cells[edit.row]?.[edit.col] ?? '') === value && base === elements) return base;
    const grown = edit.row >= cells.length ? resizeTable(el, { rows: edit.row - cells.length + 1 }) : el;
    const next = (grown.cells ?? cells).map((row, r) => (r === edit.row ? row.map((cell, c) => (c === edit.col ? value.slice(0, 500) : cell)) : row));
    return writeInto(base, el, { cells: next, height: grown.height });
  };

  // Tab and Enter below move on from the element being written in. If someone else deleted it meanwhile,
  // writing just ends, on the board as the others left it.

  /** Tab, Shift+Tab or Enter in a table: what was written stays, and the next cell opens; past the end a row is added. */
  const writeNextCell = (step: 'next' | 'back' | 'down') => {
    const edit = editing;
    if (!edit || edit.kind !== 'cell' || edit.row === undefined || edit.col === undefined) return;
    const table = edit.id ? byId.get(edit.id) : undefined;
    if (!table || !isTable(table)) return;
    const previous = writingBase();
    if (!previous.some(e => e.id === table.id)) { finishEditing(); return; }
    let base = withCellText(edit, edit.value, previous);
    missedRef.current = null;
    const now = base.find(e => e.id === table.id) as typeof table;
    const to = step === 'down' ? { row: edit.row + 1, col: edit.col } : nextCell(now, edit.row, edit.col, step === 'back' ? -1 : 1);
    if (to.row >= (now.cells ?? [['']]).length) base = base.map(e => (e.id === table.id ? resizeTable(now, { rows: 1 }) : e));
    // A table that grew takes the arrows and stamps on it along.
    base = followBindings(base);
    if (base !== elements) commit(base, previous);
    const grown = base.find(e => e.id === table.id) as typeof table;
    // A full table grows no further: writing stays in the last cell.
    const at = to.row < (grown.cells ?? [['']]).length ? to : { row: edit.row, col: edit.col };
    const b = tableCellBox(grown, at.row, at.col);
    setEditing({ id: table.id, kind: 'cell', x: b.x, y: b.y, value: grown.cells?.[at.row]?.[at.col] ?? '', row: at.row, col: at.col });
  };

  /** Enter or Tab on a mind map node: what was written stays, and a sibling (Enter) or a child (Tab) opens to write in. */
  const writeMindmap = (fromId: string, where: 'child' | 'sibling') => {
    const edit = editing;
    const previous = writingBase();
    if (!previous.some(e => e.id === fromId)) { finishEditing(); return; }
    const base = edit?.kind === 'shape' && edit.id === fromId ? withShapeText(edit, edit.value.replace(/\s+$/, ''), previous) : previous;
    missedRef.current = null;
    const { elements: next, added } = addMindmapNode(base, fromId, where, me || undefined);
    commit(next, previous);
    const b = elementBounds(next.find(el => el.id === added)!);
    setEditing({ id: added, kind: 'shape', x: b.x, y: b.y, value: '' });
    setSelection([added]);
  };

  /** Tab on a note: what was written stays, and the next note opens beside it, ready to write in. */
  const writeNextNote = (fromId: string) => {
    const edit = editing;
    const previous = writingBase();
    if (!previous.some(e => e.id === fromId)) { finishEditing(); return; }
    const base = edit?.kind === 'shape' && edit.id === fromId ? withShapeText(edit, edit.value.replace(/\s+$/, ''), previous) : previous;
    missedRef.current = null;
    const { elements: next, added } = nextNote(base, fromId, me);
    commit(next, previous);
    const note = next.find(el => el.id === added)!;
    const b = elementBounds(note);
    setEditing({ id: added, kind: 'shape', x: b.x, y: b.y, value: '' });
    setSelection([added]);
  };

  const finishEditing = () => {
    const edit = editing;
    setEditing(null);
    // Like a drawing program: after writing, the board is back to selecting.
    setTool(prev => (prev === 'text' ? 'select' : prev));
    if (!edit || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d')!;
    const { font } = paintFor(canvasRef.current);
    const value = edit.value.replace(/\s+$/, '');
    const base = writingBase();
    missedRef.current = null;
    const changed = base !== elements;
    if (edit.kind === 'cell') {
      const written = followBindings(withCellText(edit, edit.value.replace(/\s+$/, ''), base));
      if (written !== elements) commit(written, base);
      return;
    }
    if (edit.kind === 'shape') {
      const node = edit.id ? byId.get(edit.id) : undefined;
      // A branch left empty, with nothing hanging off it, was not wanted.
      if (node && isMindmap(node) && node.parent && !value && base.some(e => e.id === node.id) && !base.some(e => e.type === 'shape' && e.parent === node.id)) {
        commit(layoutMindmap(base.filter(e => e.id !== node.id), node.parent), base);
        setSelection([node.parent]);
        return;
      }
      const written = withShapeText(edit, value, base);
      if (written !== elements) commit(written, base);
      return;
    }
    if (edit.kind === 'label') {
      const el = edit.id ? byId.get(edit.id) : undefined;
      const label = value.trim().slice(0, 200) || undefined;
      if (el?.type === 'line' && (el.label !== label || changed)) commit(writeInto(base, el, { label }), base);
      else if (changed) commit(base, base);
      return;
    }
    const existing = edit.id ? byId.get(edit.id) : undefined;
    if (!value) {
      if (existing) {
        commit(followBindings(base.filter(e => e.id !== existing.id)), base);
        setSelection(prev => prev.filter(id => id !== existing.id));
      } else if (changed) commit(base, base);
      return;
    }
    if (existing?.type === 'text') {
      const text = value.slice(0, 5000);
      // A text that grew with its words takes the arrows and stamps on it along.
      if (existing.text !== text || changed) commit(followBindings(writeInto(base, existing, { text, ...measureText(ctx, text, existing.fontSize, font) })), base);
      return;
    }
    const words = value.slice(0, 5000);
    const text: WhiteboardElement = {
      id: newId(), type: 'text', x: edit.x, y: edit.y, text: words, color: style.strokeColor,
      fontSize: style.fontSize, textAlign: style.textAlign, opacity: style.opacity < 1 ? style.opacity : undefined,
      ...measureText(ctx, words, style.fontSize, font),
    };
    commit([...base, text], base);
    setSelection([text.id]);
  };

  /** An .html file onto the board, in the middle of the view, named by its title or else its file name. */
  const placePage = async (file: File) => {
    if (!addPage || readOnly) return;
    if (file.size > 300_000) { alert(t`The page is too large (at most 300 KB).`); return; }
    const html = await file.text();
    // Parsed only to read the title: a parsed document runs no scripts and loads nothing.
    const title = (new DOMParser().parseFromString(html, 'text/html').title.trim() || file.name.replace(/\.html?$/i, '')).slice(0, 120);
    const page = await addPage(title, html);
    const canvas = canvasRef.current;
    if (!page || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const el: WhiteboardHtml = { id: newId(), type: 'html', page, title, x: center.x - 320, y: center.y - 240, width: 640, height: 480 };
    commit([...elementsRef.current, el]);
    setTool('select');
    setSelection([el.id]);
  };

  // --- Rendering ---

  const render = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const paint = paintFor(canvas);
    const selectionColor = paint.ink;
    const z = camera.z;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(z, 0, 0, z, camera.x, camera.y);

    if (grid) {
      const left = -camera.x / z, top = -camera.y / z;
      const right = left + canvas.width / z, bottom = top + canvas.height / z;
      ctx.save();
      ctx.strokeStyle = readToken(canvas, '--color-rule') || '#e5e5e5';
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      for (let x = Math.floor(left / GRID) * GRID; x < right; x += GRID) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
      for (let y = Math.floor(top / GRID) * GRID; y < bottom; y += GRID) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
      ctx.stroke();
      ctx.restore();
    }

    const action = interactionRef.current;
    const shown = action.mode === 'move' || action.mode === 'resize' || action.mode === 'point' ? previewRef.current ?? elements : elements;
    const fading = action.mode === 'erase' ? action.hits : null;
    const editedId = editing?.kind === 'text' ? editing.id : null;
    drawMindmapLinks(ctx, shown);
    for (const el of shown) {
      if (el.id === editedId) continue;
      if (fading?.has(el.id)) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        drawElement(ctx, { ...el, opacity: (el.opacity ?? 1) * 0.25 }, paint);
        ctx.restore();
      } else {
        // What is being written shows only in the text field above it.
        const writing = editing && el.id === editing.id && el.type === 'shape';
        const blanked = writing && editing.kind === 'shape' ? { ...el, text: undefined }
          : writing && editing.kind === 'cell' && el.cells ? { ...el, cells: el.cells.map((row, r) => row.map((cell, c) => (r === editing.row && c === editing.col ? '' : cell))) }
          : el;
        drawElement(ctx, blanked, paint);
      }
    }
    if (action.mode === 'draw') drawElement(ctx, action.draft, paint);

    // Selection: one box per element, and handles around the whole when it can be changed.
    const chosen = new Set(selection);
    const picked = shown.filter(el => chosen.has(el.id));
    if (picked.length > 0) {
      ctx.save();
      ctx.strokeStyle = selectionColor;
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      for (const el of picked) {
        const b = elementBounds(el);
        ctx.strokeRect(b.x - 4 / z, b.y - 4 / z, b.width + 8 / z, b.height + 8 / z);
      }
      ctx.setLineDash([]);
      const editable = !readOnly && picked.every(el => !el.locked);
      if (editable) {
        ctx.fillStyle = paint.board;
        ctx.lineWidth = 1.5 / z;
        const size = HANDLE_SIZE / z;
        const single = picked.length === 1 ? picked[0] : null;
        const points = single?.type === 'line' ? single.points : handlesOf(boundsOfAll(picked)!);
        for (const p of points) {
          ctx.beginPath();
          if (single?.type === 'line') ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
          else ctx.rect(p.x - size / 2, p.y - size / 2, size, size);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // The next shape, one click away on each side of a single selected shape.
    const owner = plusOwner();
    if (owner && action.mode === 'none') {
      for (const plus of plusesOf(owner)) {
        ctx.beginPath();
        ctx.arc(plus.x, plus.y, PLUS_RADIUS / z, 0, Math.PI * 2);
        ctx.fillStyle = '#2563eb';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.moveTo(plus.x - 5 / z, plus.y); ctx.lineTo(plus.x + 5 / z, plus.y);
        ctx.moveTo(plus.x, plus.y - 5 / z); ctx.lineTo(plus.x, plus.y + 5 / z);
        ctx.stroke();
      }
    }

    // Where a connector can dock on the shape under the pointer.
    const hovered = LINE_TOOLS.includes(tool) && hoverRef.current ? shown.find(el => el.id === hoverRef.current) : undefined;
    if (hovered) {
      ctx.save();
      for (const a of anchorsOf(hovered)) {
        ctx.beginPath();
        ctx.arc(a.x, a.y, 6 / z, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2 / z;
        ctx.stroke();
      }
      ctx.restore();
    }

    if (action.mode === 'marquee') {
      ctx.save();
      ctx.strokeStyle = selectionColor;
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([2 / z, 3 / z]);
      ctx.strokeRect(action.from.x, action.from.y, action.to.x - action.from.x, action.to.y - action.from.y);
      ctx.restore();
    }
  };
  const previewRef = useRef<WhiteboardElement[] | null>(null);

  /** The one selected shape that offers the next shape on its sides. */
  const plusOwner = () => {
    if (readOnly || tool !== 'select' || editing || selected.length !== 1) return null;
    const el = selected[0];
    return el.type === 'shape' && !['section', 'task', 'table', 'mindmap'].includes(el.shapeType) && !el.locked ? el : null;
  };
  const plusesOf = (el: WhiteboardElement) => {
    const b = elementBounds(el);
    return SIDES.map(s => ({ side: s.side, x: b.x + s.fx * b.width + (s.ox * PLUS_OFFSET) / camera.z, y: b.y + s.fy * b.height + (s.oy * PLUS_OFFSET) / camera.z }));
  };
  const anchorsOf = (el: WhiteboardElement) => {
    const b = elementBounds(el);
    return SIDES.map(s => ({ x: b.x + s.fx * b.width, y: b.y + s.fy * b.height }));
  };

  useEffect(() => { render(); });

  // Images drawn by others, or kept on a filed board, are not in this client's cache yet.
  useEffect(() => {
    let cancelled = false;
    elements.forEach(el => {
      if (el.type !== 'image' || imageCache.current.has(el.src)) return;
      const img = new Image();
      // Stored images allow any origin; asking for that keeps the canvas exportable.
      if (/^https?:/.test(el.src)) img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        imageCache.current.set(el.src, img);
        setImageTick(tick => tick + 1);
      };
      img.src = el.src;
    });
    return () => { cancelled = true; };
  }, [elements]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        render();
      }
    };
    // The sheet also changes size when a panel opens beside it, without any window resize.
    const observer = new ResizeObserver(() => {
      handleResize();
      const tools = toolsRef.current;
      if (tools) setPanelTop(tools.offsetTop + tools.offsetHeight + 8);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    if (toolsRef.current) observer.observe(toolsRef.current);
    handleResize();
    return () => observer.disconnect();
  }, [elements, camera]);

  // --- Pointer ---

  const screenToWorld = (sx: number, sy: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (sx - rect.left - camera.x) / camera.z, y: (sy - rect.top - camera.y) / camera.z };
  };
  const snap = (p: WhiteboardPoint) => (grid ? { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID } : p);
  const tolerance = () => 6 / camera.z;

  const topmostAt = (p: WhiteboardPoint) => {
    for (let i = elements.length - 1; i >= 0; i--) if (hitTest(elements[i], p, tolerance())) return elements[i];
    return null;
  };

  /** A handle of the current selection under the point: a line's own point, or a corner or side of the selection box. */
  const handleAt = (p: WhiteboardPoint): { point: number } | { box: Handle } | null => {
    if (readOnly || selected.length === 0 || selected.some(el => el.locked)) return null;
    const reach = (HANDLE_SIZE / 2 + 4) / camera.z;
    if (selected.length === 1 && selected[0].type === 'line') {
      const index = selected[0].points.findIndex(q => Math.abs(q.x - p.x) <= reach && Math.abs(q.y - p.y) <= reach);
      return index === -1 ? null : { point: index };
    }
    const hit = handlesOf(boundsOfAll(selected)!).find(h => Math.abs(h.x - p.x) <= reach && Math.abs(h.y - p.y) <= reach);
    return hit ? { box: hit.h } : null;
  };

  const pointerPos = (e: React.PointerEvent) => ({ x: e.clientX, y: e.clientY });

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || e.button === 2) return;
    if (editing) { finishEditing(); return; }
    setExportOpen(false);
    setActivePage(null);
    canvasRef.current.setPointerCapture(e.pointerId);
    const screen = pointerPos(e);
    const world = screenToWorld(screen.x, screen.y);

    if (tool === 'hand' || e.button === 1 || spaceRef.current) {
      interactionRef.current = { mode: 'pan', last: screen };
      return;
    }

    if (tool === 'select') {
      // The tick box of a task card ticks it off, or opens it again.
      const ticked = readOnly ? undefined : topmostAt(world);
      if (ticked && isTask(ticked) && !ticked.locked) {
        const b = elementBounds(ticked);
        const inBox = (v: number, from: number) => v >= from - 4 && v <= from + TASK_BOX.size + 4;
        if (inBox(world.x, b.x + TASK_BOX.x) && inBox(world.y, b.y + TASK_BOX.y)) {
          e.preventDefault();
          commit(elements.map(el => (el.id === ticked.id ? { ...ticked, done: !ticked.done || undefined } : el)));
          return;
        }
      }
      const owner = plusOwner();
      const plus = owner && plusesOf(owner).find(q => Math.hypot(q.x - world.x, q.y - world.y) <= (PLUS_RADIUS + 3) / camera.z);
      if (owner && plus) {
        // Keeps the focus in the text field of the new shape.
        e.preventDefault();
        const made = connectNew(elements, owner.id, plus.side);
        const [shapeId] = made.added;
        const next = isNote(owner) ? made.elements.map(el => (el.id === shapeId ? { ...el, by: me || undefined } : el)) : made.elements;
        commit(next);
        const b = elementBounds(next.find(el => el.id === shapeId)!);
        setSelection([shapeId]);
        setEditing({ id: shapeId, kind: 'shape', x: b.x, y: b.y, value: '' });
        return;
      }
      const handle = handleAt(world);
      if (handle && 'point' in handle) {
        interactionRef.current = { mode: 'point', index: handle.point, id: selected[0].id, base: elements };
        previewRef.current = elements;
        return;
      }
      if (handle && 'box' in handle) {
        interactionRef.current = { mode: 'resize', handle: handle.box, from: world, ids: selection, base: elements, box: boundsOfAll(selected)! };
        previewRef.current = elements;
        return;
      }
      const hit = topmostAt(world);
      if (hit) {
        const unit = withGroups(elements, [hit.id]);
        if (e.shiftKey) {
          setSelection(prev => (prev.includes(hit.id) ? prev.filter(id => !unit.includes(id)) : [...new Set([...prev, ...unit])]));
          return;
        }
        const moving = selection.includes(hit.id) ? selection : unit;
        if (moving !== selection) setSelection(moving);
        const movable = moving.filter(id => !byId.get(id)?.locked);
        if (readOnly || movable.length === 0) return;
        interactionRef.current = { mode: 'move', from: world, ids: movable, base: elements };
        previewRef.current = elements;
      } else {
        if (!e.shiftKey) setSelection([]);
        interactionRef.current = { mode: 'marquee', from: world, to: world, adds: e.shiftKey };
      }
      return;
    }

    if (readOnly) return;
    setSelection([]);

    if (tool === 'text') {
      // Keeps the focus in the text field that opens now.
      e.preventDefault();
      const hit = topmostAt(world);
      startEditing(hit?.type === 'text' ? hit : null, world);
      return;
    }
    if (tool === 'eraser') {
      interactionRef.current = { mode: 'erase', path: [world], hits: new Set(touchedByPath(elements, [world], tolerance())) };
      setFrame(f => f + 1);
      return;
    }
    if (tool === 'task') {
      e.preventDefault();
      const at = snap({ x: world.x - TASK_SIZE.width / 2, y: world.y - TASK_SIZE.height / 2 });
      const task: WhiteboardElement = {
        id: newId(), type: 'shape', shapeType: 'task', ...at, ...TASK_SIZE, strokeColor: 'transparent', fillColor: '#ffffff', strokeWidth: 0,
        by: me || undefined,
      };
      commit([...elements, task]);
      setSelection([task.id]);
      setEditing({ id: task.id, kind: 'shape', x: at.x, y: at.y, value: '' });
      setTool('select');
      return;
    }
    if (tool === 'note') {
      e.preventDefault();
      const size = NOTE_SIZES[noteSize];
      const at = snap({ x: world.x - size / 2, y: world.y - size / 2 });
      const note: WhiteboardElement = {
        id: newId(), type: 'shape', shapeType: 'note', ...at, width: size, height: size,
        strokeColor: 'transparent', fillColor: noteColor, strokeWidth: 0, by: me || undefined,
      };
      commit([...elements, note]);
      setSelection([note.id]);
      setEditing({ id: note.id, kind: 'shape', x: at.x, y: at.y, value: '' });
      setTool('select');
      return;
    }
    if (tool === 'stamp') {
      // Stamps stay in hand: one click per reaction. Tape is a strip, not a badge.
      const id = newId();
      const size = stampKind === 'tape' ? TAPE_SIZE : { width: STAMP_SIZE, height: STAMP_SIZE };
      commit([...elements, {
        id, type: 'stamp', stamp: stampKind, x: world.x - size.width / 2, y: world.y - size.height / 2, ...size,
        by: stampKind === 'tape' ? undefined : me || undefined, on: bindingAt(elements, world, id, tolerance()),
      }]);
      return;
    }
    if (tool === 'table') {
      e.preventDefault();
      const columns = 3, rows = 3;
      const at = snap({ x: world.x - (columns * TABLE_CELL.width) / 2, y: world.y - (rows * TABLE_CELL.height) / 2 });
      const table: WhiteboardElement = {
        id: newId(), type: 'shape', shapeType: 'table', ...at, width: columns * TABLE_CELL.width, height: rows * TABLE_CELL.height,
        cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => '')),
        strokeColor: style.strokeColor, fillColor: style.fillColor === 'transparent' ? TABLE_HEAD_FILL : style.fillColor, strokeWidth: 1.5,
        opacity: style.opacity < 1 ? style.opacity : undefined,
      };
      commit([...elements, table]);
      setTool('select');
      startEditing(table);
      return;
    }
    if (tool === 'mindmap') {
      e.preventDefault();
      const at = snap({ x: world.x - MINDMAP_NODE.width / 2, y: world.y - MINDMAP_NODE.height / 2 });
      const root: WhiteboardElement = {
        id: newId(), type: 'shape', shapeType: 'mindmap', ...at, ...MINDMAP_NODE, strokeColor: style.strokeColor, fillColor: '#ffffff', strokeWidth: 2,
        by: me || undefined, opacity: style.opacity < 1 ? style.opacity : undefined,
      };
      commit([...elements, root]);
      setSelection([root.id]);
      setEditing({ id: root.id, kind: 'shape', x: at.x, y: at.y, value: '' });
      setTool('select');
      return;
    }

    const start = LINE_TOOLS.includes(tool) ? anchorNear(world) ?? snap(world) : snap(world);
    const look = { opacity: style.opacity < 1 ? style.opacity : undefined };
    let draft: WhiteboardElement;
    if (tool === 'pen') {
      draft = { id: newId(), type: 'stroke', tool: 'pen', color: style.strokeColor, size: style.strokeWidth, points: [world], ...look };
    } else if (tool === 'marker') {
      draft = { id: newId(), type: 'stroke', tool: 'marker', color: style.markerColor, size: MARKER_SIZE, points: [world], ...look };
    } else if (LINE_TOOLS.includes(tool)) {
      const id = newId();
      const arrows = tool !== 'line';
      draft = {
        id, type: 'line', points: [start, start], strokeColor: style.strokeColor, strokeWidth: style.strokeWidth,
        strokeStyle: style.strokeStyle === 'solid' ? undefined : style.strokeStyle,
        startArrow: arrows ? style.startArrow || undefined : undefined,
        endArrow: arrows ? style.endArrow || undefined : undefined,
        elbow: tool === 'connector' || undefined,
        ...look,
      };
    } else if (tool === 'section') {
      draft = {
        id: newId(), type: 'shape', shapeType: 'section', x: start.x, y: start.y, width: 0, height: 0,
        strokeColor: '#18181b', fillColor: SECTION_FILL_DEFAULT, strokeWidth: 0,
      };
    } else {
      draft = {
        id: newId(), type: 'shape', shapeType: tool === 'shape' ? moreShape : tool as 'rectangle' | 'diamond' | 'circle', x: start.x, y: start.y, width: 0, height: 0,
        strokeColor: style.strokeColor, fillColor: style.fillColor, strokeWidth: style.strokeWidth,
        strokeStyle: style.strokeStyle === 'solid' ? undefined : style.strokeStyle,
        fillStyle: style.fillStyle === 'solid' ? undefined : style.fillStyle,
        roundness: tool === 'rectangle' || tool === 'diamond' ? style.roundness : undefined, ...look,
        fontSize: style.fontSize,
      };
    }
    interactionRef.current = { mode: 'draw', draft, from: start };
    setFrame(f => f + 1);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const screen = pointerPos(e);
    const world = screenToWorld(screen.x, screen.y);
    const action = interactionRef.current;
    lastPointerRef.current = world;
    onCursorRef.current?.(chat?.text ? { x: world.x, y: world.y, chat: chat.text } : { x: world.x, y: world.y });
    if (LINE_TOOLS.includes(tool) && (action.mode === 'none' || action.mode === 'draw')) updateHover(world);

    if (action.mode === 'none') {
      if (tool === 'hand' || spaceRef.current) canvas.style.cursor = 'grab';
      else if (tool !== 'select') canvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
      else {
        const handle = handleAt(world);
        canvas.style.cursor = handle ? ('point' in handle ? 'move' : HANDLE_CURSORS[handle.box]) : topmostAt(world) ? (readOnly ? 'pointer' : 'move') : 'default';
      }
      return;
    }

    switch (action.mode) {
      case 'pan': {
        canvas.style.cursor = 'grabbing';
        setCamera(prev => ({ ...prev, x: prev.x + screen.x - action.last.x, y: prev.y + screen.y - action.last.y }));
        interactionRef.current = { ...action, last: screen };
        return;
      }
      case 'marquee':
        interactionRef.current = { ...action, to: world };
        break;
      case 'move': {
        let dx = world.x - action.from.x, dy = world.y - action.from.y;
        if (grid) { dx = Math.round(dx / GRID) * GRID; dy = Math.round(dy / GRID) * GRID; }
        previewRef.current = moveSelection(action.base, action.ids, dx, dy);
        break;
      }
      case 'resize': {
        const box = resizedBox(action.box, action.handle, world.x - action.from.x, world.y - action.from.y, e.shiftKey);
        previewRef.current = scaleInto(action.base, action.ids, action.box, grid ? { ...box, ...snap(box) } : box);
        break;
      }
      case 'point': {
        previewRef.current = action.base.map(el => {
          if (el.id !== action.id || el.type !== 'line') return el;
          const points = [...el.points];
          const anchor = points[action.index === 0 ? 1 : action.index - 1];
          points[action.index] = e.shiftKey && anchor ? snapAngle(anchor, world) : snap(world);
          const side = action.index === 0 ? 'start' : action.index === points.length - 1 ? 'end' : null;
          return side ? { ...el, points, [side]: undefined } : { ...el, points };
        });
        break;
      }
      case 'draw': {
        const d = action.draft;
        if (d.type === 'stroke') d.points.push(world);
        else if (d.type === 'line') d.points[1] = e.shiftKey ? snapAngle(action.from, world) : anchorNear(world, d.id) ?? snap(world);
        else if (d.type === 'shape') {
          const end = snap(world);
          let w = end.x - action.from.x, h = end.y - action.from.y;
          if (e.shiftKey) {
            const dim = Math.max(Math.abs(w), Math.abs(h));
            w = w < 0 ? -dim : dim;
            h = h < 0 ? -dim : dim;
          }
          d.width = w;
          d.height = h;
        }
        break;
      }
      case 'erase': {
        const from = action.path[action.path.length - 1];
        // Fill the gap between pointer events, so a fast stroke still touches what it crossed.
        const steps = Math.max(1, Math.ceil(Math.hypot(world.x - from.x, world.y - from.y) / (tolerance() * 1.5)));
        const added = Array.from({ length: steps }, (_, i) => ({ x: from.x + ((world.x - from.x) * (i + 1)) / steps, y: from.y + ((world.y - from.y) * (i + 1)) / steps }));
        action.path.push(...added);
        touchedByPath(elements, added, tolerance()).forEach(id => action.hits.add(id));
        break;
      }
    }
    setFrame(f => f + 1);
  };

  const handlePointerUp = () => {
    const action = interactionRef.current;
    interactionRef.current = { mode: 'none' };
    setSettled(n => n + 1);
    const preview = previewRef.current;
    previewRef.current = null;

    switch (action.mode) {
      case 'marquee': {
        const box = {
          x: Math.min(action.from.x, action.to.x), y: Math.min(action.from.y, action.to.y),
          width: Math.abs(action.to.x - action.from.x), height: Math.abs(action.to.y - action.from.y),
        };
        // A click on empty space is not a rectangle; it only clears the selection, which pointer down already did.
        if (box.width * camera.z > 3 || box.height * camera.z > 3) {
          // A section is picked only when the whole of it is in the box: dragging across one picks what lies on it.
          const caught = (el: WhiteboardElement) => {
            const b = elementBounds(el);
            return isSection(el)
              ? b.x >= box.x && b.y >= box.y && b.x + b.width <= box.x + box.width && b.y + b.height <= box.y + box.height
              : rectsTouch(b, box);
          };
          const inside = withGroups(elements, elements.filter(caught).map(el => el.id));
          setSelection(prev => (action.adds ? [...new Set([...prev, ...inside])] : inside));
        }
        break;
      }
      case 'move':
      case 'resize':
        if (preview && preview !== action.base) commit(preview);
        break;
      case 'point': {
        if (!preview) break;
        // A dragged end lands on whatever it is dropped on.
        commit(preview.map(el => {
          if (el.id !== action.id || el.type !== 'line') return el;
          const last = el.points.length - 1;
          if (action.index !== 0 && action.index !== last) return el;
          return bindEnd(preview, el, action.index === 0 ? 'start' : 'end', tolerance());
        }));
        break;
      }
      case 'draw': {
        const d = action.draft;
        if (d.type === 'stroke') {
          commit([...elements, d]);
          break;
        }
        if (d.type === 'line') {
          const [a, b] = d.points;
          if (Math.hypot(b.x - a.x, b.y - a.y) * camera.z < 4) break;
          commit([...elements, bindEnd(elements, bindEnd(elements, d, 'start', tolerance()), 'end', tolerance())]);
        } else if (d.type === 'shape') {
          let normalized = { ...d, ...elementBounds(d) };
          const tiny = normalized.width * camera.z < 3 && normalized.height * camera.z < 3;
          if (d.shapeType === 'section') {
            // A click lays a section of the usual size; it goes behind everything and asks for its name.
            if (tiny) normalized = { ...normalized, ...SECTION_SIZE };
            commit([normalized, ...elements]);
            setSelection([d.id]);
            setTool('select');
            setEditing({ id: d.id, kind: 'shape', x: normalized.x, y: normalized.y, value: '' });
            break;
          }
          if (tiny) break;
          commit([...elements, normalized]);
        }
        // Like a drawing program: after a shape or a line, the new element is selected and ready to move.
        setSelection([d.id]);
        setTool('select');
        break;
      }
      case 'erase':
        deleteIds([...action.hits]);
        break;
    }
    setFrame(f => f + 1);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly || tool !== 'select') return;
    const world = screenToWorld(e.clientX, e.clientY);
    const hit = topmostAt(world);
    if (hit?.locked) return;
    if (hit?.type === 'html') setActivePage(hit.id);
    else if (hit && isTable(hit)) startEditing(hit, undefined, tableCellAt(hit, world) ?? undefined);
    else if (hit?.type === 'text' || hit?.type === 'shape' || hit?.type === 'line') startEditing(hit);
    else if (!hit) startEditing(null, world);
  };

  /** The shape a connector would dock on under the pointer, shown with its docking points. */
  const updateHover = (world: WhiteboardPoint) => {
    let id: string | null = null;
    for (let i = elements.length - 1; i >= 0; i--) {
      if (connectable(elements[i]) && hitTest(elements[i], world, ANCHOR_REACH / camera.z)) { id = elements[i].id; break; }
    }
    if (id !== hoverRef.current) { hoverRef.current = id; setFrame(f => f + 1); }
  };
  /** A docking point of the hovered shape close to the pointer. */
  const anchorNear = (world: WhiteboardPoint, selfId?: string) => {
    const el = hoverRef.current && hoverRef.current !== selfId ? byId.get(hoverRef.current) : undefined;
    return el ? anchorsOf(el).find(a => Math.hypot(a.x - world.x, a.y - world.y) <= ANCHOR_REACH / camera.z) ?? null : null;
  };

  // --- Camera ---

  const zoomTo = (z: number, at?: WhiteboardPoint) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = at?.x ?? canvas.width / 2, cy = at?.y ?? canvas.height / 2;
    setCamera(prev => {
      const next = Math.min(Math.max(z, 0.1), 10);
      return { x: cx - ((cx - prev.x) / prev.z) * next, y: cy - ((cy - prev.y) / prev.z) * next, z: next };
    });
  };
  const zoomIn = () => zoomTo(camera.z * 1.2);
  const zoomOut = () => zoomTo(camera.z / 1.2);
  const FIT_PAD = 80;
  // The floating toolbar covers the top of the sheet; what is shown goes below it.
  const TOOLBAR_SPACE = 96;
  const centerOn = (box: Rect, z: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = Math.min(Math.max(z, 0.1), 10);
    setCamera({ x: canvas.width / 2 - (box.x + box.width / 2) * next, y: (canvas.height + TOOLBAR_SPACE) / 2 - (box.y + box.height / 2) * next, z: next });
  };
  const fitZoom = (box: Rect) => {
    const canvas = canvasRef.current!;
    return Math.min(Math.max(Math.min((canvas.width - FIT_PAD * 2) / Math.max(box.width, 1), (canvas.height - TOOLBAR_SPACE - FIT_PAD * 2) / Math.max(box.height, 1)), 0.1), 2);
  };
  const zoomToFit = () => {
    const box = boundsOfAll(elements);
    if (!canvasRef.current || !box) { setCamera({ x: 0, y: 0, z: 1 }); return; }
    centerOn(box, fitZoom(box));
  };

  const focusedRef = useRef<string | null>(null);
  /** Someone who is not in the call, such as the assistant, pointing for a moment at what they just changed. */
  const [visitor, setVisitor] = useState<{ key: string; name: string; at: WhiteboardPoint } | null>(null);
  useEffect(() => {
    if (!visitor) return;
    const timer = window.setTimeout(() => setVisitor(null), CHAT_SHOWN_MS + 1000);
    return () => window.clearTimeout(timer);
  }, [visitor]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!focus || focusedRef.current === focus.key || !canvas || canvas.width === 0) return;
    // Someone drawing keeps their view; the next change of the board tries again.
    if (interactionRef.current.mode !== 'none' || editing) return;
    const targets = elements.filter(el => focus.ids.includes(el.id));
    // The assistant's change can arrive here after its request to show it.
    if (targets.length < focus.ids.length) return;
    focusedRef.current = focus.key;
    const box = boundsOfAll(targets.length ? targets : elements);
    if (focus.by && targets.length > 0 && box) setVisitor({ key: focus.key, name: focus.by, at: { x: box.x + box.width, y: box.y + box.height } });
    if (focus.mode === 'reveal') {
      if (!box) return;
      const z = camera.z;
      const view = { x: -camera.x / z, y: -camera.y / z, width: canvas.width / z, height: canvas.height / z };
      const inside = box.x >= view.x && box.y >= view.y && box.x + box.width <= view.x + view.width && box.y + box.height <= view.y + view.height;
      if (inside) return;
      centerOn(box, Math.min(z, fitZoom(box)));
    } else if (focus.mode === 'fit' || (focus.mode === 'in' && targets.length > 0)) {
      if (box) centerOn(box, fitZoom(box));
    } else {
      const z = camera.z * (focus.mode === 'in' ? 1.5 : 1 / 1.5);
      if (targets.length > 0 && box) centerOn(box, z);
      else zoomTo(z);
    }
  }, [focus, elements, editing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = canvas.getBoundingClientRect();
        zoomTo(camera.z * (e.deltaY > 0 ? 0.9 : 1.1), { x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        setCamera(prev => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [camera]);

  // --- Keyboard ---

  useEffect(() => {
    const TOOL_KEYS: Record<string, Tool> = {
      v: 'select', '1': 'select', h: 'hand', r: 'rectangle', '2': 'rectangle', d: 'diamond', '3': 'diamond',
      o: 'circle', '4': 'circle', a: 'arrow', '5': 'arrow', l: 'line', '6': 'line', p: 'pen', '7': 'pen', m: 'marker',
      t: 'text', '8': 'text', e: 'eraser', '0': 'eraser', n: 'note', s: 'section', c: 'connector', k: 'stamp',
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // Chat, notes and the board's own name field keep their keys.
      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === ' ' && !spaceRef.current) { spaceRef.current = true; return; }
      if (mod && key === 'a') {
        e.preventDefault();
        setTool('select');
        setSelection(elements.map(el => el.id));
      } else if (e.key === 'Escape') {
        setSelection([]);
        setActivePage(null);
        setExportOpen(false);
        setStampsOpen(false);
        setShapesOpen(false);
        setTemplatesOpen(false);
        setSectionsOpen(false);
        setTool(prev => (prev === 'stamp' ? 'select' : prev));
      } else if (e.key === '/' && !mod && onCursorRef.current && lastPointerRef.current) {
        e.preventDefault();
        setChat({ typing: true, text: '' });
      } else if (e.shiftKey && e.code === 'Digit1') {
        zoomToFit();
      } else if (mod && e.key === '0') {
        e.preventDefault();
        setCamera({ x: 0, y: 0, z: 1 });
      } else if (mod && e.key === "'") {
        e.preventDefault();
        setGrid(g => !g);
      } else if (readOnly) {
        if (!mod && (key === 'v' || key === 'h' || key === '1')) setTool(TOOL_KEYS[key]);
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        selectionActions?.onDuplicate();
      } else if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) selectionActions?.onUngroup(); else if (selectionActions?.canGroup) selectionActions.onGroup();
      } else if (mod && e.shiftKey && key === 'l') {
        e.preventDefault();
        selectionActions?.onLock(!selectionActions.locked);
      } else if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        e.preventDefault();
        const up = e.code === 'BracketRight';
        selectionActions?.onOrder(e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      } else if (e.key === 'Enter' && selected.length === 1 && (selected[0].type === 'text' || selected[0].type === 'shape' || selected[0].type === 'line') && !selected[0].locked) {
        e.preventDefault();
        startEditing(selected[0]);
      } else if (e.key === 'Tab' && !mod && (e.target === document.body || e.target === canvasRef.current) && selected.length === 1 && isNote(selected[0]) && !selected[0].locked) {
        e.preventDefault();
        writeNextNote(selected[0].id);
      } else if (e.key === 'Tab' && !mod && (e.target === document.body || e.target === canvasRef.current) && selected.length === 1 && isMindmap(selected[0]) && !selected[0].locked) {
        e.preventDefault();
        writeMindmap(selected[0].id, 'child');
      } else if (!mod && !e.altKey && e.shiftKey && key === 't') {
        setTool('task');
      } else if (e.key.startsWith('Arrow') && unlockedSelection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? (grid ? GRID : 10) : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        commit(moveSelection(elements, unlockedSelection, dx, dy));
      } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
        setTool(TOOL_KEYS[key]);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') spaceRef.current = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  });

  // --- Clipboard ---

  // Copy and cut: the selection goes to the board clipboard, from where it can be pasted onto any board.
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || selected.length === 0) return;
      // Text selected on the page is what a copy there means, whatever is selected on the board.
      if (window.getSelection()?.toString()) return;
      const marker = `tavio-board:${newId()}`;
      boardClipboard = { marker, elements: JSON.parse(JSON.stringify(selected)), source: boardSource, pageRoom, pastes: 0 };
      // Elsewhere the copy reads as the words on it; the marker rides along in the HTML for a paste onto a board.
      const text = boardText(selected);
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      e.clipboardData?.setData('text/plain', text);
      e.clipboardData?.setData('text/html', `<span data-tavio-board="${marker}">${escaped}</span>`);
      e.preventDefault();
      if (e.type === 'cut') deleteSelected();
    };
    window.addEventListener('copy', handleCopy);
    window.addEventListener('cut', handleCopy);
    return () => {
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('cut', handleCopy);
    };
  }, [selected, boardSource, pageRoom, deleteSelected]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (readOnly || isTypingTarget(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      // Elements copied from this or another board, if they are still the last thing copied.
      if (boardClipboard && (e.clipboardData?.getData('text/html') ?? '').includes(`data-tavio-board="${boardClipboard.marker}"`)) {
        e.preventDefault();
        const sameBoard = boardClipboard.source === boardSource;
        boardClipboard.pastes += 1;
        const steps = sameBoard ? boardClipboard.pastes : boardClipboard.pastes - 1;
        // Pages and uploaded images belong to their room and go when it is deleted, so they stay behind.
        // After a cut they stay on the clipboard too: pasted back in their room, they return.
        const fromHere = boardClipboard.pageRoom === pageRoom;
        const ownedByRoom = (el: WhiteboardElement) => el.type === 'html' || (el.type === 'image' && !el.src.startsWith('data:'));
        const copied = fromHere ? boardClipboard.elements : boardClipboard.elements.filter(el => !ownedByRoom(el));
        if (copied.length < boardClipboard.elements.length) alert(t`Pages and uploaded images stay in their room: paste them there, or upload them here.`);
        if (!copied.length) return;
        const pasted = copiesForBoard(copied, steps * PASTE_STEP);
        commit([...elements, ...pasted]);
        setTool('select');
        setSelection(pasted.map(el => el.id));
        return;
      }

      const page = Array.from(items).find(item => item.kind === 'file' && item.type === 'text/html')?.getAsFile();
      if (page) {
        e.preventDefault();
        void placePage(page);
        return;
      }

      const hasImage = Array.from(items).some(item => item.type.startsWith('image/'));
      const words = e.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n').trim();
      if (!hasImage && words) {
        // Text from anywhere else becomes text on the board, in the middle of the view.
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        const { font } = paintFor(canvas);
        const value = words.slice(0, 5000);
        const size = measureText(ctx, value, style.fontSize, font);
        const rect = canvas.getBoundingClientRect();
        const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const text: WhiteboardElement = {
          id: newId(), type: 'text', x: center.x - size.width / 2, y: center.y - size.height / 2, text: value,
          color: style.strokeColor, fontSize: style.fontSize, textAlign: style.textAlign, ...size,
        };
        commit([...elementsRef.current, text]);
        setTool('select');
        setSelection([text.id]);
        return;
      }

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === -1) continue;
        const blob = items[i].getAsFile();
        if (!blob) continue;
        // SECURITY: Validate image size and type
        if (blob.size > 5 * 1024 * 1024) { alert('Image too large (max 5MB)'); continue; }
        if (!blob.type.startsWith('image/')) { alert('Only images are allowed'); continue; }
        void (async () => {
          // A blob: address only works in this tab; the others need the image from the server.
          const url = uploadImage ? await uploadImage(blob) : URL.createObjectURL(blob);
          if (!url) return;
          const img = new Image();
          if (!url.startsWith('blob:')) img.crossOrigin = 'anonymous';
          img.onload = () => {
            imageCache.current.set(url, img);
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const center = screenToWorld(rect.width / 2 + rect.left, rect.height / 2 + rect.top);
            const width = 300;
            const height = width / (img.width / img.height);
            commit([...elementsRef.current, { id: newId(), type: 'image', src: url, x: center.x - width / 2, y: center.y - height / 2, width, height }]);
          };
          img.src = url;
        })();
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

  // SECURITY: Cleanup blob URLs to prevent memory leaks
  useEffect(() => () => {
    imageCache.current.forEach((_, url) => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
    imageCache.current.clear();
  }, []);

  // --- Export ---

  /** The whole board (or the selection), not just what is in view. */
  const exported = () => (selected.length > 0 ? selected : elements);
  const save = (href: string, name: string) => {
    const link = document.createElement('a');
    link.download = name;
    link.href = href;
    link.click();
  };
  const downloadPng = () => {
    setExportOpen(false);
    const canvas = canvasRef.current;
    const items = exported();
    const box = boundsOfAll(items);
    if (!canvas || !box) return;
    const pad = 32, scale = 2;
    const out = document.createElement('canvas');
    out.width = Math.ceil((box.width + pad * 2) * scale);
    out.height = Math.ceil((box.height + pad * 2) * scale);
    const ctx = out.getContext('2d')!;
    const paint = paintFor(canvas);
    ctx.fillStyle = paint.board || '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.setTransform(scale, 0, 0, scale, (pad - box.x) * scale, (pad - box.y) * scale);
    drawMindmapLinks(ctx, items);
    items.forEach(el => drawElement(ctx, el, paint));
    save(out.toDataURL('image/png'), 'whiteboard.png');
  };
  const downloadSvg = () => {
    setExportOpen(false);
    const canvas = canvasRef.current;
    if (!canvas || !boundsOfAll(exported())) return;
    const { board, ink, font } = paintFor(canvas);
    const holder = document.createElement('div');
    const root = createRoot(holder);
    flushSync(() => root.render(<BoardSvg elements={exported()} paint={{ board, ink, font }} background />));
    const markup = holder.innerHTML;
    root.unmount();
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    save(url, 'whiteboard.svg');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const clearCanvas = () => {
    setSelection([]);
    commit([]);
  };

  // --- Text field ---

  const editStyle = (): React.CSSProperties | undefined => {
    if (!editing || !canvasRef.current) return undefined;
    const z = camera.z;
    const { font } = paintFor(canvasRef.current);
    if (editing.kind === 'label') {
      return {
        left: camera.x + (editing.x - 90) * z, top: camera.y + (editing.y - 12) * z, width: 180 * z, height: 24 * z,
        fontSize: 14 * z, lineHeight: `${24 * z}px`, fontFamily: font, fontWeight: 600, textAlign: 'center', background: '#ffffff',
      };
    }
    if (editing.kind === 'cell') {
      const el = editing.id ? byId.get(editing.id) : undefined;
      if (!el || !isTable(el)) return undefined;
      const rows = el.cells?.length ?? 1;
      // A cell past the last row is the new row that comes with this text.
      const b = tableCellBox(el.cells && editing.row! >= rows ? resizeTable(el, { rows: editing.row! - rows + 1 }) : el, editing.row!, editing.col!);
      const fontSize = el.fontSize ?? TABLE_FONT_SIZE;
      return {
        left: camera.x + b.x * z, top: camera.y + b.y * z, width: b.width * z, height: b.height * z, padding: `${(TABLE_PADDING / 2) * z}px ${TABLE_PADDING * z}px`,
        fontSize: fontSize * z, lineHeight: `${lineHeightFor(fontSize) * z}px`, fontFamily: font, fontWeight: editing.row === 0 ? 600 : 400,
        textAlign: el.textAlign ?? 'left', whiteSpace: 'pre-wrap', background: '#ffffff',
      };
    }
    if (editing.kind === 'shape') {
      const el = editing.id ? byId.get(editing.id) : undefined;
      const b = el ? elementBounds(el) : { x: editing.x, y: editing.y, width: 200, height: 100 };
      if (el && isSection(el)) {
        return {
          left: camera.x + b.x * z, top: camera.y + (b.y - SECTION_TAB_HEIGHT) * z, width: Math.min(b.width, SECTION_TAB_MAX_WIDTH) * z,
          height: (SECTION_TAB_HEIGHT - 4) * z, padding: `0 ${10 * z}px`, fontSize: 14 * z, lineHeight: `${(SECTION_TAB_HEIGHT - 4) * z}px`,
          fontFamily: font, fontWeight: 600,
        };
      }
      if (el && isTask(el)) {
        return {
          left: camera.x + (b.x + TASK_TEXT_X) * z, top: camera.y + (b.y + TASK_BOX.y) * z, width: (b.width - TASK_TEXT_X - 12) * z,
          height: (b.height - TASK_BOX.y - TASK_FOOT) * z, padding: 0, fontSize: TASK_FONT_SIZE * z, lineHeight: `${lineHeightFor(TASK_FONT_SIZE) * z}px`,
          fontFamily: font, fontWeight: 500, whiteSpace: 'pre-wrap', background: '#ffffff',
        };
      }
      if (el && isNote(el)) {
        const ctx = canvasRef.current.getContext('2d')!;
        const fit = fitNoteText(editing.value || ' ', b.width - 2 * NOTE_INSET, b.height - 2 * NOTE_INSET - NOTE_FOOT, (run, size) => {
          ctx.font = `500 ${size}px ${font}`;
          return ctx.measureText(run).width;
        });
        return {
          left: camera.x + b.x * z, top: camera.y + b.y * z, width: b.width * z, height: (b.height - NOTE_FOOT) * z,
          padding: NOTE_INSET * z, fontSize: fit.fontSize * z, lineHeight: `${fit.lineHeight * z}px`, fontFamily: font, fontWeight: 500, whiteSpace: 'pre-wrap',
        };
      }
      // As the shape will show it: its size, alignment and colour, centred down the shape.
      const look = el && isMindmap(el)
        ? { fontSize: el.fontSize ?? MINDMAP_FONT_SIZE, align: el.textAlign ?? 'center', color: el.parent ? undefined : '#ffffff', weight: el.parent ? 500 : 600 }
        : el?.type === 'shape' ? shapeText(el, { ink: 'var(--ink-black)' }) : null;
      const fontSize = look?.fontSize ?? 18;
      const pad = el && isMindmap(el) ? MINDMAP_PADDING : NOTE_PADDING;
      const ctx = canvasRef.current.getContext('2d')!;
      ctx.font = `${look?.weight ?? 400} ${fontSize}px ${font}`;
      const lines = wrapText(ctx, editing.value || ' ', b.width - 2 * pad).length;
      const top = Math.max(pad, (b.height - lines * lineHeightFor(fontSize)) / 2);
      return {
        left: camera.x + b.x * z, top: camera.y + b.y * z, width: b.width * z, height: b.height * z,
        padding: `${top * z}px ${pad * z}px 0`, fontSize: fontSize * z, lineHeight: `${lineHeightFor(fontSize) * z}px`, fontFamily: font,
        fontWeight: look?.weight, textAlign: look?.align, color: look?.color, whiteSpace: 'pre-wrap',
      };
    }
    const el = editing.id ? byId.get(editing.id) : undefined;
    const fontSize = el?.type === 'text' ? el.fontSize : style.fontSize;
    const ctx = canvasRef.current.getContext('2d')!;
    const size = measureText(ctx, editing.value || ' ', fontSize, font);
    return {
      left: camera.x + editing.x * z, top: camera.y + editing.y * z,
      width: (size.width + fontSize) * z, height: size.height * z,
      fontSize: fontSize * z, lineHeight: `${lineHeightFor(fontSize) * z}px`, fontFamily: font,
      color: el?.type === 'text' ? el.color : style.strokeColor,
      textAlign: el?.type === 'text' ? el.textAlign ?? 'left' : style.textAlign,
    };
  };

  // A sentence said at the cursor stays a moment after it was sent, then goes.
  useEffect(() => {
    if (!chat || chat.typing) return;
    const timer = window.setTimeout(() => setChat(null), CHAT_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [chat]);
  useEffect(() => {
    const at = lastPointerRef.current;
    if (at) onCursorRef.current?.(chat?.text ? { ...at, chat: chat.text } : at);
  }, [chat]);

  const toScreen = (p: WhiteboardPoint) => ({ left: camera.x + p.x * camera.z, top: camera.y + p.y * camera.z });

  const selectedTask = selected.length === 1 && isTask(selected[0]) && !selected[0].locked && !readOnly && !editing
    && interactionRef.current.mode === 'none' ? selected[0] : null;
  const taskBarAt = selectedTask ? toScreen(elementBounds(selectedTask)) : null;
  const changeTask = (patch: { done?: boolean; owner?: string; due?: string }) => {
    if (!selectedTask) return;
    const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v || undefined]));
    // Two changes in one go (the name field loses focus as the tick box is clicked) build on each other.
    const next = elementsRef.current.map(el => (el.id === selectedTask.id ? { ...el, ...clean } as WhiteboardElement : el));
    elementsRef.current = next;
    commit(next);
  };
  const people = Array.from(new Set([me, ...Object.values(cursors ?? {}).map(c => c.name)].filter((n): n is string => !!n)));
  const selectedNotes = selected.filter(isNote);
  const showNoteBar = !readOnly && !editing && selected.length > 0 && selectedNotes.length === selected.length && !selected.some(el => el.locked)
    && interactionRef.current.mode === 'none';
  const noteBarAt = showNoteBar ? toScreen(boundsOfAll(selected)!) : null;
  const restyleNotes = (patch: { fillColor?: string; size?: NoteSize }) => {
    const ids = new Set(selectedNotes.map(el => el.id));
    if (patch.fillColor) setNoteColor(patch.fillColor);
    if (patch.size) setNoteSize(patch.size);
    const side = patch.size ? NOTE_SIZES[patch.size] : 0;
    commit(followBindings(elements.map(el => (ids.has(el.id) && el.type === 'shape'
      ? { ...el, ...(patch.fillColor ? { fillColor: patch.fillColor } : {}), ...(side ? { width: side, height: side } : {}) }
      : el))));
  };
  const noteColorNames = [t`Yellow`, t`Green`, t`Blue`, t`Pink`, t`Violet`];
  const stampNames: Record<WhiteboardStampKind, string> = {
    thumb: t`Thumbs up`, heart: t`Heart`, star: t`Star`, check: t`Done`, question: t`Question`, plus1: t`Plus one`, spark: t`Idea`, no: t`No`, tape: t`Tape`,
  };
  const shapeNames: Record<WhiteboardMoreShape, string> = {
    speech: t`Speech bubble`, cylinder: t`Database`, hexagon: t`Hexagon`, star: t`Star`, parallelogram: t`Parallelogram`,
    'block-arrow': t`Arrow shape`, triangle: t`Triangle`, cloud: t`Cloud`,
  };
  const [yellow, green, blue, pink, violet] = NOTE_COLORS;
  const templates: { name: string; size: { width: number; height: number }; columns: TemplateColumn[] }[] = [
    { name: t`Retrospective`, size: { width: 420, height: 600 }, columns: [
      { title: t`Went well`, fill: green, prompt: t`What went well?` },
      { title: t`To improve`, fill: pink, prompt: t`What got in the way?` },
      { title: t`Ideas`, fill: blue, prompt: t`What could we try?` },
      { title: t`Actions`, fill: yellow, prompt: t`Who does what, by when?` },
    ] },
    { name: t`Kanban`, size: { width: 420, height: 640 }, columns: [
      { title: t`To do`, fill: yellow, prompt: t`A task` },
      { title: t`Doing`, fill: blue, prompt: t`Being worked on` },
      { title: t`Done`, fill: green, prompt: t`Finished` },
    ] },
    { name: t`Brainstorming`, size: { width: 460, height: 600 }, columns: [
      { title: t`Question`, fill: violet, prompt: t`What do we want to solve?` },
      { title: t`Ideas`, fill: yellow, prompt: t`One idea per note` },
      { title: t`Favourites`, fill: pink, prompt: t`Move the best ideas here` },
    ] },
    { name: t`Week plan`, size: { width: 300, height: 600 }, columns: [t`Monday`, t`Tuesday`, t`Wednesday`, t`Thursday`, t`Friday`].map(title => ({ title, fill: yellow, prompt: '' })) },
  ];
  const placeTemplate = (template: typeof templates[number]) => {
    setTemplatesOpen(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const width = template.columns.length * (template.size.width + 40) - 40;
    const { elements: next, added } = fromTemplate(elements, template.columns, template.size, { x: center.x - width / 2, y: center.y - template.size.height / 2 }, me);
    commit(next);
    setTool('select');
    setSelection([]);
    const box = boundsOfAll(next.filter(el => added.includes(el.id)));
    if (box) centerOn({ ...box, y: box.y - SECTION_TAB_HEIGHT, height: box.height + SECTION_TAB_HEIGHT }, fitZoom(box));
  };
  const sections = elements.filter(isSection);

  const panelKinds = selected.length > 0 ? kindsOfAll(selected) : toolKinds();
  const showPanel = !readOnly && (selected.length > 0 || hasKinds(panelKinds));
  const selectedTable = selected.length === 1 && isTable(selected[0]) && !selected[0].locked && !readOnly && !editing
    && interactionRef.current.mode === 'none' ? selected[0] : null;
  const tableBarAt = selectedTable ? toScreen(elementBounds(selectedTable)) : null;
  const changeTable = (change: { rows?: number; columns?: number }) => {
    if (!selectedTable) return;
    commit(followBindings(elements.map(el => (el.id === selectedTable.id ? resizeTable(selectedTable, change) : el))));
  };
  const tableSize = selectedTable?.cells ? { rows: selectedTable.cells.length, columns: selectedTable.cells[0].length } : null;
  const toolButton = (value: Tool, label: string, icon: React.ReactNode, key: string) => (
    <ToolbarButton label={label} onClick={() => { setTool(value); setSelection([]); }} active={tool === value} shortcut={key || undefined}>{icon}</ToolbarButton>
  );

  return (
    <div
      ref={containerRef}
      className="wb stock h-full w-full overflow-hidden"
      onDragOver={e => { if (addPage && e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={e => {
        const file = Array.from(e.dataTransfer.files).find(f => f.type === 'text/html' || /\.html?$/i.test(f.name));
        if (!file || !addPage) return;
        e.preventDefault();
        void placePage(file);
      }}
    >
      <canvas
        ref={canvasRef}
        aria-label={t`Whiteboard`}
        className="absolute inset-0 block h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => { if (!chat) onCursorRef.current?.({ hide: true }); }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={e => e.preventDefault()}
      />

      {renderPage && (
        <div className="wb__pages">
          {elements.filter((el): el is WhiteboardHtml => el.type === 'html').map(el => {
            const at = toScreen({ x: el.x, y: el.y + PAGE_BAR });
            return (
              <div
                key={el.id}
                className={`wb__page ${activePage === el.id ? 'is-active' : ''}`}
                style={{ ...at, width: el.width, height: el.height - PAGE_BAR, transform: `scale(${camera.z})`, opacity: el.opacity }}
              >
                {renderPage(el)}
              </div>
            );
          })}
        </div>
      )}

      {marks && (
        <div className="wb__marks" aria-hidden="true">
          {elements.filter(el => marks[el.id]).map(el => {
            const b = elementBounds(el);
            return <span key={el.id} className="wb__mark" style={toScreen({ x: b.x + b.width, y: b.y })}>{marks[el.id]}</span>;
          })}
        </div>
      )}

      {renderPin && (
        <div className="wb__pins">
          {elements.map(el => {
            const pin = renderPin(el, selected.length === 1 && selected[0].id === el.id && !editing);
            if (!pin) return null;
            const b = elementBounds(el);
            return <div key={el.id} className="wb__pin" style={toScreen({ x: b.x, y: b.y + b.height })}>{pin}</div>;
          })}
        </div>
      )}

      {editing && (
        <textarea
          className="wb__edit"
          aria-label={editing.kind === 'shape' ? t`Text in the shape` : editing.kind === 'label' ? t`Label` : editing.kind === 'cell' ? t`Cell` : t`Text`}
          autoFocus
          value={editing.value}
          style={editStyle()}
          onChange={e => setEditing(prev => (prev ? { ...prev, value: e.target.value } : prev))}
          onBlur={finishEditing}
          onKeyDown={e => {
            e.stopPropagation();
            const el = editing.id ? byId.get(editing.id) : undefined;
            if (e.key === 'Tab' && el && isNote(el)) { e.preventDefault(); writeNextNote(el.id); return; }
            if (editing.kind === 'cell' && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey))) {
              e.preventDefault();
              writeNextCell(e.key === 'Enter' ? 'down' : e.shiftKey ? 'back' : 'next');
              return;
            }
            if (el && isMindmap(el) && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey))) {
              e.preventDefault();
              writeMindmap(el.id, e.key === 'Tab' ? 'child' : 'sibling');
              return;
            }
            // A name and a label are one line.
            const oneLine = editing.kind === 'label' || (el && isSection(el));
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey || oneLine))) { e.preventDefault(); finishEditing(); }
          }}
        />
      )}

      {selectedTask && taskBarAt && (
        <div className="wb__notebar wb__taskbar stock stock--lift" role="toolbar" aria-label={t`Task`} style={{ left: taskBarAt.left, top: taskBarAt.top }}>
          <label className="wb__taskfield">
            <input type="checkbox" checked={!!selectedTask.done} onChange={e => changeTask({ done: e.target.checked })} />
            <Trans>Done</Trans>
          </label>
          <span className="fmt__sep" />
          <input
            key={`who-${selectedTask.id}`}
            className="wb__taskinput"
            aria-label={t`Who`}
            placeholder={t`Who`}
            list="wb-people"
            maxLength={60}
            defaultValue={selectedTask.owner ?? ''}
            onBlur={e => { if (e.target.value.trim() !== (selectedTask.owner ?? '')) changeTask({ owner: e.target.value.trim() }); }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
          <datalist id="wb-people">{people.map(name => <option key={name} value={name} />)}</datalist>
          <input
            type="date"
            className="wb__taskinput fig"
            aria-label={t`Due`}
            value={selectedTask.due ?? ''}
            onChange={e => changeTask({ due: e.target.value })}
          />
        </div>
      )}

      {selectedTable && tableBarAt && tableSize && (
        <div className="wb__notebar stock stock--lift" role="toolbar" aria-label={t`Table`} style={{ left: tableBarAt.left, top: tableBarAt.top }}>
          <button type="button" className="wb__size" onClick={() => changeTable({ rows: 1 })} disabled={tableSize.rows >= TABLE_LIMITS.rows}><Trans>+ Row</Trans></button>
          <button type="button" className="wb__size" onClick={() => changeTable({ rows: -1 })} disabled={tableSize.rows <= 1}><Trans>− Row</Trans></button>
          <span className="fmt__sep" />
          <button type="button" className="wb__size" onClick={() => changeTable({ columns: 1 })} disabled={tableSize.columns >= TABLE_LIMITS.columns}><Trans>+ Column</Trans></button>
          <button type="button" className="wb__size" onClick={() => changeTable({ columns: -1 })} disabled={tableSize.columns <= 1}><Trans>− Column</Trans></button>
        </div>
      )}

      {showNoteBar && noteBarAt && (
        <div className="wb__notebar stock stock--lift" role="toolbar" aria-label={t`Note`} style={{ left: noteBarAt.left, top: noteBarAt.top }}>
          {NOTE_COLORS.map((color, i) => (
            <button
              key={color}
              type="button"
              className={`swatch ${selectedNotes.every(el => el.type === 'shape' && el.fillColor === color) ? 'is-on' : ''}`}
              style={{ backgroundColor: color }}
              title={noteColorNames[i]}
              aria-label={noteColorNames[i]}
              onClick={() => restyleNotes({ fillColor: color })}
            />
          ))}
          <span className="fmt__sep" />
          {(Object.keys(NOTE_SIZES) as NoteSize[]).map(size => (
            <button
              key={size}
              type="button"
              className={`wb__size ${selectedNotes.every(el => elementBounds(el).width === NOTE_SIZES[size]) ? 'is-on' : ''}`}
              aria-label={size === 's' ? t`Small` : size === 'm' ? t`Medium` : t`Large`}
              onClick={() => restyleNotes({ size })}
            >
              {size.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div className="wb__cursors" aria-hidden="true">
        {Object.entries({ ...cursors, ...(visitor ? { [`visitor-${visitor.key}`]: { name: visitor.name, ...visitor.at } as LiveCursor } : {}) }).map(([id, cursor]) => {
          const ink = personInk(cursor.name);
          return (
            <div key={id} className="wb__cursor" style={toScreen(cursor)}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 2.5 20 11l-7 1.8L9.6 20Z" fill={ink} stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" /></svg>
              <span className="wb__cursor-name" style={{ backgroundColor: ink }}>{cursor.name}</span>
              {cursor.chat && <span className="wb__cursor-chat" style={{ backgroundColor: ink }}>{cursor.chat}</span>}
            </div>
          );
        })}
      </div>
      {chat && lastPointerRef.current && (
        <div className="wb__cursor wb__cursor--mine" style={toScreen(lastPointerRef.current)}>
          {chat.typing ? (
            <input
              className="wb__cursor-chat wb__chat-input"
              style={{ backgroundColor: personInk(me ?? '') }}
              aria-label={t`Say something at your cursor`}
              placeholder={t`Say something`}
              autoFocus
              maxLength={80}
              value={chat.text}
              onChange={e => setChat({ typing: true, text: e.target.value })}
              onBlur={() => setChat(prev => (prev?.text ? { typing: false, text: prev.text } : null))}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') setChat(prev => (prev?.text ? { typing: false, text: prev.text } : null));
                if (e.key === 'Escape') setChat(null);
              }}
            />
          ) : <span className="wb__cursor-chat" style={{ backgroundColor: personInk(me ?? '') }}>{chat.text}</span>}
        </div>
      )}

      {elements.length === 0 && !editing && <p className="wb__empty">{readOnly ? <Trans>This board is empty</Trans> : <Trans>Empty whiteboard</Trans>}</p>}

      {/* Before the toolbar: on the same layer, the toolbar's menus open over the card. */}
      {showPanel && (
        <StylePanel
          kinds={panelKinds}
          style={shownStyle}
          onStyle={applyStyle}
          actions={selectionActions}
          closed={!panelOpen}
          top={panelTop}
        />
      )}

      <div ref={toolsRef} className="wb__tools stock stock--lift" role="toolbar" aria-label={t`Whiteboard`}>
        {!readOnly && <>
          <ToolbarButton label={t`Undo`} onClick={undo} disabled={!canUndo} shortcut="Control+Z"><Undo className="icon" /></ToolbarButton>
          <ToolbarButton label={t`Redo`} onClick={redo} disabled={!canRedo} shortcut="Control+Shift+Z"><Redo className="icon" /></ToolbarButton>
          <span className="fmt__sep hidden sm:block" />
        </>}

        {toolButton('select', t`Select`, <MousePointer2 className="icon" />, 'V')}
        {toolButton('hand', t`Pan`, <Hand className="icon" />, 'H')}
        {!readOnly && <>
          {toolButton('pen', t`Pen`, <PenTool className="icon" />, 'P')}
          {toolButton('marker', t`Marker`, <Highlighter className="icon" />, 'M')}
          {toolButton('note', t`Note`, <StickyNote className="icon" />, 'N')}
          {toolButton('task', t`Task`, <SquareCheck className="icon" />, 'Shift+T')}
          {toolButton('rectangle', t`Rectangle`, <Square className="icon" />, 'R')}
          {toolButton('diamond', t`Diamond`, <Diamond className="icon" />, 'D')}
          {toolButton('circle', t`Circle`, <Circle className="icon" />, 'O')}
          <span className="wb__export">
            <ToolbarButton label={t`More shapes`} onClick={() => { setShapesOpen(o => !o); setSelection([]); }} active={tool === 'shape' || shapesOpen}>
              {tool === 'shape' ? <ShapeGlyph kind={moreShape} /> : <Shapes className="icon" />}
            </ToolbarButton>
            {shapesOpen && (
              <span className="menu wb__stamps stock stock--lift" role="menu" aria-label={t`More shapes`}>
                {WHITEBOARD_MORE_SHAPES.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitemradio"
                    aria-checked={tool === 'shape' && moreShape === kind}
                    className={`wb__stamp ${tool === 'shape' && moreShape === kind ? 'is-on' : ''}`}
                    title={shapeNames[kind]}
                    aria-label={shapeNames[kind]}
                    onClick={() => { setMoreShape(kind); setTool('shape'); setShapesOpen(false); }}
                  >
                    <ShapeGlyph kind={kind} />
                  </button>
                ))}
              </span>
            )}
          </span>
          {toolButton('section', t`Section`, <Frame className="icon" />, 'S')}
          {toolButton('arrow', t`Arrow`, <MoveUpRight className="icon" />, 'A')}
          {toolButton('connector', t`Connector`, <CornerDownRight className="icon" />, 'C')}
          {toolButton('line', t`Line`, <Minus className="icon" />, 'L')}
          {toolButton('text', t`Text`, <Type className="icon" />, 'T')}
          {toolButton('table', t`Table`, <Table2 className="icon" />, '')}
          {toolButton('mindmap', t`Mind map`, <Network className="icon" />, '')}
          <span className="wb__export">
            <ToolbarButton label={t`Stamp`} onClick={() => { setStampsOpen(o => !o); setSelection([]); }} active={tool === 'stamp' || stampsOpen} shortcut="K">
              <Stamp className="icon" />
            </ToolbarButton>
            {stampsOpen && (
              <span className="menu wb__stamps stock stock--lift" role="menu" aria-label={t`Stamps`}>
                {WHITEBOARD_STAMPS.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitemradio"
                    aria-checked={tool === 'stamp' && stampKind === kind}
                    className={`wb__stamp ${tool === 'stamp' && stampKind === kind ? 'is-on' : ''}`}
                    title={stampNames[kind]}
                    aria-label={stampNames[kind]}
                    onClick={() => { setStampKind(kind); setTool('stamp'); setStampsOpen(false); }}
                  >
                    <StampGlyph kind={kind} />
                  </button>
                ))}
              </span>
            )}
          </span>
          <span className="wb__export">
            <ToolbarButton label={t`Templates`} onClick={() => setTemplatesOpen(o => !o)} active={templatesOpen}><LayoutTemplate className="icon" /></ToolbarButton>
            {templatesOpen && (
              <span className="menu wb__export-menu stock stock--lift" role="menu" aria-label={t`Templates`}>
                {templates.map(template => (
                  <button key={template.name} type="button" className="menu__item" role="menuitem" onClick={() => placeTemplate(template)}>{template.name}</button>
                ))}
              </span>
            )}
          </span>
          {addPage && <>
            <ToolbarButton label={t`HTML page`} onClick={() => pageInputRef.current?.click()}><FileCode className="icon" /></ToolbarButton>
            <input
              ref={pageInputRef}
              type="file"
              accept=".html,.htm,text/html"
              hidden
              onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void placePage(file); }}
            />
          </>}
          {toolButton('eraser', t`Eraser`, <Eraser className="icon" />, 'E')}
          <span className="wb__props-toggle">
            <ToolbarButton label={t`Style`} onClick={() => setPanelOpen(o => !o)} active={panelOpen && showPanel} disabled={!showPanel}><SlidersHorizontal className="icon" /></ToolbarButton>
          </span>
        </>}

        <span className="fmt__sep hidden sm:block" />

        <ToolbarButton label={t`Zoom out`} onClick={zoomOut}><ZoomOut className="icon" /></ToolbarButton>
        <button type="button" className="wb__zoom fig hidden sm:block" onClick={zoomToFit} title={t`Zoom to fit`} aria-label={t`Zoom to fit`} aria-keyshortcuts="Shift+1">
          {Math.round(camera.z * 100)}%
        </button>
        <ToolbarButton label={t`Zoom in`} onClick={zoomIn}><ZoomIn className="icon" /></ToolbarButton>
        <ToolbarButton label={t`Grid`} onClick={() => setGrid(g => !g)} active={grid} shortcut="Control+'"><Grid3x3 className="icon" /></ToolbarButton>
        {sections.length > 0 && (
          <span className="wb__export">
            <ToolbarButton label={t`Sections`} onClick={() => setSectionsOpen(o => !o)} active={sectionsOpen}><LayoutPanelTop className="icon" /></ToolbarButton>
            {sectionsOpen && (
              <span className="menu wb__export-menu stock stock--lift" role="menu">
                {sections.map(section => (
                  <button
                    key={section.id}
                    type="button"
                    className="menu__item"
                    role="menuitem"
                    onClick={() => { setSectionsOpen(false); const b = elementBounds(section); centerOn({ ...b, y: b.y - SECTION_TAB_HEIGHT, height: b.height + SECTION_TAB_HEIGHT }, fitZoom(b)); }}
                  >
                    {(section.type === 'shape' && section.text?.trim()) || t`Section without a name`}
                  </button>
                ))}
              </span>
            )}
          </span>
        )}

        <span className="fmt__sep hidden sm:block" />

        {!readOnly && (onNewBoard
          ? <ToolbarButton label={selection.length > 0 ? t`New board with the selection` : t`New board`} onClick={onNewBoard} disabled={elements.length === 0}><Plus className="icon" /></ToolbarButton>
          : <ToolbarButton label={t`Clear canvas`} onClick={clearCanvas}><Trash2 className="icon" /></ToolbarButton>)}
        <span className="wb__export">
          <ToolbarButton label={t`Download`} onClick={() => setExportOpen(o => !o)} active={exportOpen} disabled={elements.length === 0}><Download className="icon" /></ToolbarButton>
          {exportOpen && (
            <span className="menu wb__export-menu stock stock--lift" role="menu">
              <button type="button" className="menu__item" role="menuitem" onClick={downloadPng}>
                {selected.length > 0 ? <Trans>Selection as PNG</Trans> : <Trans>Board as PNG</Trans>}
              </button>
              <button type="button" className="menu__item" role="menuitem" onClick={downloadSvg}>
                {selected.length > 0 ? <Trans>Selection as SVG</Trans> : <Trans>Board as SVG</Trans>}
              </button>
            </span>
          )}
        </span>
        {onClose && <ToolbarButton label={t`Close`} onClick={onClose}><X className="icon" /></ToolbarButton>}
      </div>

      {children}
    </div>
  );
};
