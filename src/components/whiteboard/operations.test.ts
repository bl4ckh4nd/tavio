import { describe, expect, it } from 'vitest';
import type { WhiteboardElement } from '../../types';
import {
  addMindmapNode, align, bindEnd, bindingAt, boardSignature, connectNew, fromTemplate, withSectionContents, distribute, duplicate, followBindings, group,
  layoutMindmap, moveSelection, nextCell, nextNote, rebaseWriting, reorder, resizeTable, restyle, snapAngle, TABLE_LIMITS, ungroup, withGroups, writeElement,
} from './operations';

const box = (id: string, x: number, y: number, over: Record<string, unknown> = {}): WhiteboardElement => ({
  id, type: 'shape', shapeType: 'rectangle', x, y, width: 100, height: 50,
  strokeColor: '#18181b', fillColor: 'transparent', strokeWidth: 2, ...over,
} as WhiteboardElement);
const ids = (elements: WhiteboardElement[]) => elements.map(el => el.id);

describe('whiteboard operations', () => {
  it('restyles the selection with what fits each kind and leaves the rest alone', () => {
    const elements: WhiteboardElement[] = [
      box('a', 0, 0),
      { id: 'p', type: 'stroke', tool: 'pen', color: '#18181b', size: 2, points: [{ x: 0, y: 0 }] },
      { id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'x', color: '#18181b', fontSize: 20 },
      box('untouched', 0, 0),
    ];
    const out = restyle(elements, ['a', 'p', 't'], { strokeColor: '#dc2626', fillColor: '#2563eb', strokeWidth: 4, fontSize: 28, strokeStyle: 'dashed' });
    expect(out[0]).toMatchObject({ strokeColor: '#dc2626', fillColor: '#2563eb', strokeWidth: 4, strokeStyle: 'dashed' });
    expect(out[1]).toMatchObject({ color: '#dc2626', size: 4 });
    expect(out[1]).not.toHaveProperty('fillColor');
    expect(out[2]).toMatchObject({ color: '#dc2626', fontSize: 28 });
    expect(out[2]).not.toHaveProperty('strokeWidth');
    expect(out[3]).toBe(elements[3]);
  });

  it('brings to the front, sends back and moves one step, keeping the order among the moved', () => {
    const elements = ['a', 'b', 'c', 'd'].map((id, i) => box(id, i, 0));
    expect(ids(reorder(elements, ['a', 'b'], 'front'))).toEqual(['c', 'd', 'a', 'b']);
    expect(ids(reorder(elements, ['d'], 'back'))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(reorder(elements, ['b'], 'forward'))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(reorder(elements, ['a'], 'backward'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('aligns edges and centres, moving a group as one', () => {
    const elements = [box('a', 0, 0), box('b', 300, 40), box('c', 120, 100, { groupId: 'g' }), box('d', 220, 100, { groupId: 'g' })];
    const left = align(elements, ['a', 'b', 'c', 'd'], 'left');
    expect(left.map(el => (el as { x: number }).x)).toEqual([0, 0, 0, 100]);
    const middle = align(elements, ['a', 'b'], 'middle');
    expect(middle.map(el => (el as { y: number }).y)).toEqual([20, 20, 100, 100]);
  });

  it('spreads three or more evenly between the outer two', () => {
    const elements = [box('a', 0, 0), box('b', 120, 0), box('c', 400, 0)];
    const spread = distribute(elements, ['a', 'b', 'c'], 'horizontal');
    expect(spread.map(el => (el as { x: number }).x)).toEqual([0, 200, 400]);
    expect(distribute(elements, ['a', 'b'], 'horizontal')).toBe(elements);
  });

  it('groups, finds the whole group from one member, and ungroups', () => {
    const elements = [box('a', 0, 0), box('b', 0, 0), box('c', 0, 0)];
    const grouped = group(elements, ['a', 'b']);
    expect(withGroups(grouped, ['a']).sort()).toEqual(['a', 'b']);
    expect(withGroups(grouped, ['c'])).toEqual(['c']);
    expect(withGroups(ungroup(grouped, ['a']), ['a'])).toEqual(['a']);
  });

  it('duplicates beside the original with new ids, a new group and its arrows still attached to the copies', () => {
    const elements: WhiteboardElement[] = [
      box('a', 0, 0, { groupId: 'g' }),
      { id: 'l', type: 'line', points: [{ x: 100, y: 25 }, { x: 200, y: 25 }], strokeColor: '#18181b', strokeWidth: 2, start: { id: 'a', fx: 1, fy: 0.5 }, groupId: 'g' },
    ];
    const { elements: out, added } = duplicate(elements, ['a', 'l'], 20);
    expect(out).toHaveLength(4);
    const [copyBox, copyLine] = added.map(id => out.find(el => el.id === id)!);
    expect(copyBox).toMatchObject({ x: 20, y: 20 });
    expect(copyBox.id).not.toBe('a');
    expect(copyBox.groupId).toBeTruthy();
    expect(copyBox.groupId).not.toBe('g');
    expect(copyLine.groupId).toBe(copyBox.groupId);
    expect(copyLine.type === 'line' && copyLine.start?.id).toBe(copyBox.id);
  });

  it('keeps an arrow on the shapes it is bound to after they move, and lets go of a deleted one', () => {
    const arrow: WhiteboardElement = {
      id: 'l', type: 'line', points: [{ x: 100, y: 25 }, { x: 300, y: 25 }], strokeColor: '#18181b', strokeWidth: 2,
      start: { id: 'a', fx: 1, fy: 0.5 }, end: { id: 'b', fx: 0, fy: 0.5 }, endArrow: true,
    };
    const moved = followBindings([box('a', 0, 100), box('b', 300, 0), arrow]);
    expect(moved[2].type === 'line' && moved[2].points).toEqual([{ x: 100, y: 125 }, { x: 300, y: 25 }]);
    const orphaned = followBindings([box('a', 0, 0), arrow]);
    expect(orphaned[1].type === 'line' && orphaned[1].end).toBeUndefined();
    const unchanged = [box('a', 0, 0), box('b', 300, 0), arrow];
    expect(followBindings(unchanged)).toBe(unchanged);
  });

  it('moves a selection; an arrow moved with its shapes stays bound, one moved alone lets go, one left behind follows', () => {
    const arrow = (id: string): WhiteboardElement => ({
      id, type: 'line', points: [{ x: 100, y: 25 }, { x: 300, y: 25 }], strokeColor: '#18181b', strokeWidth: 2,
      start: { id: 'a', fx: 1, fy: 0.5 }, end: { id: 'b', fx: 0, fy: 0.5 },
    });
    const base = [box('a', 0, 0), box('b', 300, 0)];
    const together = moveSelection([...base, arrow('l')], ['a', 'b', 'l'], 10, 10);
    expect(together[2]).toMatchObject({ start: { id: 'a' }, end: { id: 'b' }, points: [{ x: 110, y: 35 }, { x: 310, y: 35 }] });
    const alone = moveSelection([...base, arrow('l')], ['l'], 0, 50);
    expect(alone[2].type === 'line' && [alone[2].start, alone[2].end]).toEqual([undefined, undefined]);
    const behind = moveSelection([...base, arrow('l')], ['b'], 0, 100);
    expect(behind[2].type === 'line' && behind[2].points[1]).toEqual({ x: 300, y: 125 });
  });

  it('binds an arrow end to the shape under it, as a fraction of its box, but not to lines or the arrow itself', () => {
    const elements: WhiteboardElement[] = [
      box('a', 0, 0),
      { id: 'l', type: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], strokeColor: '#18181b', strokeWidth: 2 },
    ];
    expect(bindingAt(elements, { x: 100, y: 25 }, 'new', 6)).toEqual({ id: 'a', fx: 1, fy: 0.5 });
    expect(bindingAt(elements, { x: 104, y: 25 }, 'new', 6)).toEqual({ id: 'a', fx: 1, fy: 0.5 });
    expect(bindingAt(elements, { x: 400, y: 400 }, 'new', 6)).toBeUndefined();
    expect(bindingAt([elements[1]], { x: 50, y: 25 }, 'new', 6)).toBeUndefined();
  });

  it('snaps a line to steps of 15 degrees, keeping its length', () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 100, y: 3 });
    expect(p.y).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(Math.hypot(100, 3));
    const diagonal = snapAngle({ x: 0, y: 0 }, { x: 50, y: 47 });
    expect(diagonal.x).toBeCloseTo(diagonal.y);
  });

  it('docks an arrow end dropped inside a shape on the shape\'s edge, facing where the arrow comes from', () => {
    const arrow: Extract<WhiteboardElement, { type: 'line' }> = {
      id: 'l', type: 'line', points: [{ x: 300, y: 25 }, { x: 50, y: 25 }], strokeColor: '#18181b', strokeWidth: 2,
    };
    const docked = bindEnd([box('a', 0, 0), arrow], arrow, 'end', 6);
    expect(docked.points[1]).toEqual({ x: 100, y: 25 });
    expect(docked.end).toEqual({ id: 'a', fx: 1, fy: 0.5 });
    expect(docked.start).toBeUndefined();
    const free = bindEnd([box('a', 0, 0), arrow], { ...arrow, points: [{ x: 300, y: 25 }, { x: 250, y: 300 }] }, 'end', 6);
    expect(free.end).toBeUndefined();
    expect(free.points[1]).toEqual({ x: 250, y: 300 });
  });

  it('gives a board the same signature however its fields are ordered, and ignores fields left undefined', () => {
    const sent = [{ ...box('a', 0, 0), groupId: undefined, strokeStyle: 'dashed' } as WhiteboardElement];
    // What Convex sends back: the same element with its fields sorted, undefined ones dropped.
    const stored = sent.map(el => Object.fromEntries(Object.entries(el).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)))) as WhiteboardElement[];
    expect(boardSignature(stored)).toBe(boardSignature(sent));
    expect(boardSignature([{ ...sent[0], strokeStyle: 'dotted' } as WhiteboardElement])).not.toBe(boardSignature(sent));
  });
  it('puts the next note beside a note, empty and in its colour and size, past notes already there', () => {
    const elements = [
      box('n1', 0, 0, { shapeType: 'note', width: 200, height: 200, fillColor: '#d6e6fb', strokeWidth: 0, text: 'Eins', by: 'Sara' }),
      box('n2', 224, 0, { shapeType: 'note', width: 200, height: 200, fillColor: '#fbe7b0', strokeWidth: 0, text: 'Zwei' }),
    ];
    const { elements: next, added } = nextNote(elements, 'n1', 'Jonas');
    const note = next.find(el => el.id === added)!;
    expect(note).toMatchObject({ shapeType: 'note', x: 448, y: 0, width: 200, height: 200, fillColor: '#d6e6fb', text: '', by: 'Jonas' });
    expect(ids(next)).toEqual(['n1', 'n2', added]);
  });

  it('carries what lies fully on a section when the section moves; what only overlaps it stays, arrows follow', () => {
    const elements = [
      box('s', 0, 0, { shapeType: 'section', width: 600, height: 400, text: 'Ideen' }),
      box('in', 50, 50),
      box('half', 550, 50),
      box('out', 800, 50),
      { id: 'a', type: 'line', points: [{ x: 150, y: 75 }, { x: 800, y: 75 }], strokeColor: '#000', strokeWidth: 2, start: { id: 'in', fx: 1, fy: 0.5 }, end: { id: 'out', fx: 0, fy: 0.5 } } as WhiteboardElement,
    ];
    const moved = moveSelection(elements, ['s'], 10, 20);
    const byId = new Map(moved.map(el => [el.id, el]));
    expect(byId.get('in')).toMatchObject({ x: 60, y: 70 });
    expect(byId.get('half')).toBe(elements[2]);
    expect(byId.get('out')).toBe(elements[3]);
    expect(byId.get('a')).toMatchObject({ points: [{ x: 160, y: 95 }, { x: 800, y: 75 }] });
  });

  it('keeps a connector carried by a section bound to a shape that stayed behind', () => {
    const elements = [
      box('s', 0, 0, { shapeType: 'section', width: 600, height: 400 }),
      box('in', 50, 50),
      box('half', 550, 50),
      { id: 'a', type: 'line', elbow: true, points: [{ x: 150, y: 75 }, { x: 550, y: 75 }], strokeColor: '#000', strokeWidth: 2, start: { id: 'in', fx: 1, fy: 0.5 }, end: { id: 'half', fx: 0, fy: 0.5 } } as WhiteboardElement,
    ];
    const arrow = moveSelection(elements, ['s'], 10, 20).find(el => el.id === 'a');
    expect(arrow).toMatchObject({ points: [{ x: 160, y: 95 }, { x: 550, y: 75 }], start: { id: 'in' }, end: { id: 'half' } });
  });

  it('binds an arrow end neither to a section nor to a stamp, but to what lies on the section', () => {
    const elements = [
      box('s', 0, 0, { shapeType: 'section', width: 600, height: 400 }),
      box('r', 100, 100),
      { id: 'st', type: 'stamp', stamp: 'heart', x: 300, y: 300, width: 44, height: 44 } as WhiteboardElement,
    ];
    expect(bindingAt(elements, { x: 50, y: 50 }, 'x', 4)).toBeUndefined();
    expect(bindingAt(elements, { x: 320, y: 320 }, 'x', 4)).toBeUndefined();
    expect(bindingAt(elements, { x: 150, y: 125 }, 'x', 4)?.id).toBe('r');
  });

  it('keeps a stamp on the element it was put on, and drops it with that element', () => {
    const elements = [
      box('r', 0, 0),
      { id: 'st', type: 'stamp', stamp: 'star', x: 78, y: -22, width: 44, height: 44, on: { id: 'r', fx: 1, fy: 0 } } as WhiteboardElement,
    ];
    expect(moveSelection(elements, ['r'], 50, 10).find(el => el.id === 'st')).toMatchObject({ x: 128, y: -12 });
    expect(followBindings([elements[1]])).toEqual([]);
  });

  it('sticks a stamp moved on its own to what it is dropped on, or to nothing', () => {
    const elements = [
      box('r', 0, 0),
      box('q', 300, 0),
      { id: 'st', type: 'stamp', stamp: 'star', x: 78, y: -22, width: 44, height: 44, on: { id: 'r', fx: 1, fy: 0 } } as WhiteboardElement,
    ];
    const onQ = moveSelection(elements, ['st'], 250, 40).find(el => el.id === 'st');
    expect(onQ).toMatchObject({ x: 328, y: 18, on: { id: 'q', fx: 0.5, fy: 0.8 } });
    const loose = moveSelection(elements, ['st'], 0, 500).find(el => el.id === 'st');
    expect(loose).toMatchObject({ x: 78, y: 478, on: undefined });
  });

  it('adds the next shape on a side, already joined by an elbow connector', () => {
    const elements = [box('r', 0, 0, { text: 'Start', author: 'assistant' })];
    const { elements: next, added } = connectNew(elements, 'r', 'right');
    const [shape, arrow] = added.map(id => next.find(el => el.id === id)!);
    expect(shape).toMatchObject({ shapeType: 'rectangle', x: 180, y: 0, width: 100, height: 50, text: '' });
    expect(shape).not.toHaveProperty('author', 'assistant');
    expect(arrow).toMatchObject({
      type: 'line', elbow: true, endArrow: true,
      points: [{ x: 100, y: 25 }, { x: 180, y: 25 }], start: { id: 'r', fx: 1, fy: 0.5 }, end: { id: shape.id, fx: 0, fy: 0.5 },
    });
  });

  it('lays a template out as named sections side by side beside what is there, each with a starter note it carries', () => {
    const there = [box('old', 0, 0)];
    const columns = [
      { title: 'To do', fill: '#fbe7b0', prompt: 'A task' },
      { title: 'Doing', fill: '#d6e6fb', prompt: 'In progress' },
      { title: 'Done', fill: '#d4edd9', prompt: 'Finished' },
    ];

    const { elements, added } = fromTemplate(there, columns, { width: 400, height: 600 }, { x: -500, y: -500 }, 'Lena');

    const sections = elements.filter(el => el.type === 'shape' && el.shapeType === 'section') as any[];
    expect(sections.map(s => s.text)).toEqual(['To do', 'Doing', 'Done']);
    for (let i = 1; i < sections.length; i++) expect(sections[i].x).toBeGreaterThanOrEqual(sections[i - 1].x + 400);
    // Beside what is there, not on it.
    expect(sections[0].x).toBeGreaterThan(100);
    for (const [i, section] of sections.entries()) {
      const carried = withSectionContents(elements, [section.id]).filter(id => id !== section.id);
      expect(carried.map(id => (elements.find(el => el.id === id) as any).text)).toEqual([columns[i].prompt]);
      expect(elements.find(el => el.id === carried[0])).toMatchObject({ shapeType: 'note', fillColor: columns[i].fill, by: 'Lena' });
    }
    expect(added).toHaveLength(6);
    // On an empty board it goes where it was asked to.
    expect(fromTemplate([], columns, { width: 400, height: 600 }, { x: -500, y: -500 }).elements[0]).toMatchObject({ x: -500, y: -500 });
  });
  it('writes the text style into a shape, so the words in it can be sized, aligned and coloured', () => {
    const out = restyle([box('a', 0, 0, { text: 'Start' })], ['a'], { fontSize: 28, textAlign: 'right', strokeColor: '#dc2626' });
    expect(out[0]).toMatchObject({ fontSize: 28, textAlign: 'right', strokeColor: '#dc2626' });
  });

  it('grows a mind map: Tab adds a child to the right, Enter a sibling below, branches take a colour and keep it', () => {
    const root = box('root', 0, 0, { shapeType: 'mindmap', width: 120, height: 40, text: 'Launch' });
    const first = addMindmapNode([root], 'root', 'child');
    const a = first.elements.find(el => el.id === first.added) as any;
    expect(a).toMatchObject({ shapeType: 'mindmap', parent: 'root' });
    expect(a.x).toBeGreaterThan(120);
    const second = addMindmapNode(first.elements, a.id, 'sibling');
    const b = second.elements.find(el => el.id === second.added) as any;
    expect(b.parent).toBe('root');
    // Each branch off the root has its own colour; what grows from a branch inherits it.
    expect(b.strokeColor).not.toBe(a.strokeColor);
    const third = addMindmapNode(second.elements, b.id, 'child');
    expect(third.elements.find(el => el.id === third.added)).toMatchObject({ parent: b.id, strokeColor: b.strokeColor });
    // The branches sit one above the other, centred on the root, and do not overlap.
    const laid = layoutMindmap(third.elements, 'root');
    const [na, nb] = [a.id, b.id].map(id => laid.find(el => el.id === id) as any);
    expect(na.x).toBe(nb.x);
    expect(nb.y).toBeGreaterThanOrEqual(na.y + na.height);
    const centre = (el: any) => el.y + el.height / 2;
    expect(Math.abs((centre(na) + centre(nb)) / 2 - 20)).toBeLessThan(30);
    // A sibling of the root is a child of it: a map has one root.
    expect(addMindmapNode([root], 'root', 'sibling').elements.at(-1)).toMatchObject({ parent: 'root' });
  });

  it('takes a whole branch along when its node is moved, and away when its node is deleted', () => {
    const root = box('root', 0, 0, { shapeType: 'mindmap', width: 120, height: 40 });
    const kid = box('kid', 200, 0, { shapeType: 'mindmap', parent: 'root', width: 100, height: 40 });
    const grandkid = box('gk', 400, 0, { shapeType: 'mindmap', parent: 'kid', width: 100, height: 40 });
    const moved = moveSelection([root, kid, grandkid], ['kid'], 10, 30);
    expect(moved.find(el => el.id === 'gk')).toMatchObject({ x: 410, y: 30 });
    expect(moved.find(el => el.id === 'root')).toMatchObject({ x: 0, y: 0 });
    expect(ids(followBindings([root, grandkid]))).toEqual(['root']);
  });

  it('adds and removes table rows and columns, keeping what is written and the size of a cell', () => {
    const table = box('t', 0, 0, { shapeType: 'table', width: 300, height: 90, cells: [['A', 'B', 'C'], ['1', '2', '3'], ['', '', '']] }) as any;
    const wider = resizeTable(table, { columns: 1 }) as any;
    expect(wider).toMatchObject({ width: 400, height: 90 });
    expect(wider.cells).toEqual([['A', 'B', 'C', ''], ['1', '2', '3', ''], ['', '', '', '']]);
    const shorter = resizeTable(table, { rows: -1 }) as any;
    expect(shorter).toMatchObject({ height: 60, cells: [['A', 'B', 'C'], ['1', '2', '3']] });
    // Never fewer than one row and one column.
    expect((resizeTable(box('x', 0, 0, { shapeType: 'table', cells: [['only']] }) as any, { rows: -1, columns: -1 }) as any).cells).toEqual([['only']]);
    // Tab walks along the row, then to the next one; past the last cell it asks for a new row.
    expect(nextCell(table, 0, 2, 1)).toEqual({ row: 1, col: 0 });
    expect(nextCell(table, 1, 0, -1)).toEqual({ row: 0, col: 2 });
    expect(nextCell(table, 2, 2, 1)).toEqual({ row: 3, col: 0 });
  });

  it('finishing writing does not bring back what someone else deleted meanwhile, but keeps what was just made here', () => {
    const a = box('a', 0, 0), b = box('b', 200, 0);
    const confirmed = [a, b];
    const fresh = box('new', 400, 0);
    const here = [a, b, fresh];
    // Someone else deleted `b` while this person was writing in it.
    const base = rebaseWriting(here, confirmed, [a]);
    expect(ids(base)).toEqual(['a', 'new']);
    expect(writeElement(base, b, { text: 'written' } as Partial<WhiteboardElement>, confirmed)).toBe(base);
    const made = box('made', 600, 0);
    expect(ids(writeElement(base, made, { text: 'x' } as Partial<WhiteboardElement>, confirmed))).toEqual(['a', 'new', 'made']);
  });

  it('never grows a table past what the server stores', () => {
    const full = box('t', 0, 0, { shapeType: 'table', cells: Array.from({ length: TABLE_LIMITS.rows }, () => Array(TABLE_LIMITS.columns).fill('')) });
    const grown = resizeTable(full as never, { rows: 1, columns: 1 });
    expect(grown.cells).toHaveLength(TABLE_LIMITS.rows);
    expect(grown.cells?.[0]).toHaveLength(TABLE_LIMITS.columns);
  });
});
