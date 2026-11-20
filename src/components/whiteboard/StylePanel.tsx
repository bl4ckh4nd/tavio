import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowDown, ArrowUp, Ban, BringToFront,
  CopyPlus, Group, Lock, LockOpen, SendToBack, Trash2, Ungroup,
} from 'lucide-react';
import type { WhiteboardElement } from '../../types';
import { Groove, IconButton } from '../ui';
import type { Edge, Order, StylePatch } from './operations';

// The palette's values stay the hex strings saved in existing rows; only the swatches read the ink tokens.
const INK_TOKENS: Record<string, string> = {
  '#18181b': 'var(--ink-black)',
  '#dc2626': 'var(--ink-red)',
  '#ea580c': 'var(--ink-orange)',
  '#16a34a': 'var(--ink-green)',
  '#2563eb': 'var(--ink-blue)',
  '#7c3aed': 'var(--ink-violet)',
};
export const inkColor = (color: string) => INK_TOKENS[color] ?? color;
export const INKS = Object.keys(INK_TOKENS);
// Light fills read under text and lines; the assistant's sticky notes use the same ones.
export const FILLS = ['transparent', '#fbe7b0', '#d4edd9', '#d6e6fb', '#f9d9d9', '#e6dcf7', ...INKS];

export const WIDTHS = [2, 4, 8];
export const FONT_SIZES = [16, 20, 28, 36];
/** A marker is see-through, so its colours are the light ones of a highlighter. */
export const MARKERS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];
export const MARKER_SIZE = 20;
/** Words in a shape are this big unless set otherwise; boards from before kept them there. */
export const SHAPE_FONT_SIZE = 18;

/** The style the panel shows: what the next element gets, or what the selection has. */
export type Style = Required<Omit<StylePatch, 'startArrow' | 'endArrow'>> & { startArrow: boolean; endArrow: boolean };

/** One element's style in the panel's terms. */
export const styleOf = (el: WhiteboardElement, base: Style): Style => {
  switch (el.type) {
    case 'stroke': return el.tool === 'marker'
      ? { ...base, markerColor: el.color, opacity: el.opacity ?? 1 }
      : { ...base, strokeColor: el.color, strokeWidth: el.size, opacity: el.opacity ?? 1 };
    case 'line': return {
      ...base, strokeColor: el.strokeColor, strokeWidth: el.strokeWidth, strokeStyle: el.strokeStyle ?? 'solid',
      startArrow: !!el.startArrow, endArrow: !!el.endArrow, opacity: el.opacity ?? 1,
    };
    case 'text': return { ...base, strokeColor: el.color, fontSize: el.fontSize, textAlign: el.textAlign ?? 'left', opacity: el.opacity ?? 1 };
    case 'shape': return {
      ...base, strokeColor: el.strokeColor, fillColor: el.fillColor, strokeWidth: el.strokeWidth, strokeStyle: el.strokeStyle ?? 'solid',
      fillStyle: el.fillStyle ?? 'solid', roundness: el.roundness ?? 'sharp', opacity: el.opacity ?? 1,
      fontSize: el.fontSize ?? SHAPE_FONT_SIZE, textAlign: el.textAlign ?? 'center',
    };
    case 'image':
    case 'html':
    case 'stamp': return { ...base, opacity: el.opacity ?? 1 };
  }
};

/** Which controls the panel offers. */
export type Kinds = {
  stroke: boolean; marker: boolean; fill: boolean; hatch: boolean; width: boolean; dash: boolean; edges: boolean; arrows: boolean;
  text: boolean; opacity: boolean;
};
export const NO_KINDS: Kinds = { stroke: false, marker: false, fill: false, hatch: false, width: false, dash: false, edges: false, arrows: false, text: false, opacity: false };

/**
 * What can be styled on one element: exactly what drawing it reads. Notes and task cards draw their own
 * look (notes have their bar), so only their opacity is offered.
 */
export const kindsOf = (el: WhiteboardElement): Kinds => {
  const k = (on: Partial<Kinds>): Kinds => ({ ...NO_KINDS, opacity: true, ...on });
  switch (el.type) {
    case 'stroke': return el.tool === 'marker' ? k({ marker: true }) : k({ stroke: true, width: true });
    case 'line': return k({ stroke: true, width: true, dash: true, arrows: true });
    case 'text': return k({ stroke: true, text: true });
    case 'image':
    case 'html':
    case 'stamp': return k({});
    case 'shape':
      switch (el.shapeType) {
        case 'note':
        case 'task': return k({});
        case 'section': return k({ fill: true });
        case 'table': return k({ stroke: true, fill: true, text: true });
        case 'mindmap': return k({ stroke: true, text: true });
        default: return k({
          stroke: true, fill: true, hatch: true, width: true, dash: true, text: true,
          edges: el.shapeType === 'rectangle' || el.shapeType === 'diamond',
        });
      }
  }
};

/** What any of these elements can be styled with. */
export const kindsOfAll = (elements: WhiteboardElement[]): Kinds =>
  elements.reduce((all, el) => {
    const one = kindsOf(el);
    return Object.fromEntries(Object.entries(all).map(([key, on]) => [key, on || one[key as keyof Kinds]])) as Kinds;
  }, NO_KINDS);

export const hasKinds = (kinds: Kinds) => Object.values(kinds).some(Boolean);

const Swatch: React.FC<{ label: string; color: string; isOn: boolean; onClick: () => void }> = ({ label, color, isOn, onClick }) => {
  const isNone = color === 'transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={isOn}
      className={`swatch ${isNone ? 'swatch--none' : ''} ${isOn ? 'is-on' : ''}`}
      style={isNone ? undefined : { backgroundColor: inkColor(color) }}
    >
      {isNone && <Ban className="icon" aria-hidden="true" />}
    </button>
  );
};

const Named: React.FC<{ icon: React.ReactNode; name: string }> = ({ icon, name }) => (
  <>{icon}<span className="sr-only">{name}</span></>
);

const Section: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <div className="wb__prop">
    <span className="wb__label">{label}</span>
    {children}
  </div>
);

export type SelectionActions = {
  units: number;
  canGroup: boolean;
  canUngroup: boolean;
  locked: boolean;
  onOrder: (where: Order) => void;
  onAlign: (edge: Edge) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onLock: (locked: boolean) => void;
  onDelete: () => void;
};

type Props = {
  kinds: Kinds;
  style: Style;
  onStyle: (patch: StylePatch) => void;
  /** Only while something is selected. */
  actions?: SelectionActions;
  /** On a narrow board the card can be put away. */
  closed: boolean;
  /** Where the card starts: below the toolbar, however many rows it takes. */
  top?: number;
};

export const StylePanel: React.FC<Props> = ({ kinds, style, onStyle, actions, closed, top }) => {
  const locked = actions?.locked ?? false;
  return (
    <div
      className={`wb__props stock stock--lift ${closed ? 'is-closed' : ''}`}
      role="region"
      aria-label={t`Style`}
      style={top === undefined ? undefined : { top, maxHeight: `calc(100% - ${top}px - var(--space-sm))` }}
    >
      {!locked && <>
        {kinds.stroke && (
          <Section label={<Trans>Stroke</Trans>}>
            <div className="wb__swatches">
              {INKS.map(c => <Swatch key={c} label={t`Stroke ${c}`} color={c} isOn={style.strokeColor === c} onClick={() => onStyle({ strokeColor: c })} />)}
            </div>
          </Section>
        )}
        {kinds.marker && (
          <Section label={<Trans>Marker</Trans>}>
            <div className="wb__swatches">
              {MARKERS.map(c => <Swatch key={c} label={t`Marker ${c}`} color={c} isOn={style.markerColor === c} onClick={() => onStyle({ markerColor: c })} />)}
            </div>
          </Section>
        )}
        {kinds.fill && (
          <Section label={<Trans>Background</Trans>}>
            <div className="wb__swatches">
              {FILLS.map(c => (
                <Swatch key={c} label={c === 'transparent' ? t`No background` : t`Background ${c}`} color={c} isOn={style.fillColor === c} onClick={() => onStyle({ fillColor: c })} />
              ))}
            </div>
          </Section>
        )}
        {kinds.hatch && style.fillColor !== 'transparent' && (
          <Section label={<Trans>Fill</Trans>}>
            <Groove
              ariaLabel={t`Fill`}
              wide
              value={style.fillStyle}
              onChange={fillStyle => onStyle({ fillStyle })}
              options={[
                { value: 'solid', label: t`Solid` },
                { value: 'hachure', label: t`Hatched` },
                { value: 'cross-hatch', label: t`Crossed` },
              ]}
            />
          </Section>
        )}
        {kinds.width && (
          <Section label={<Trans>Stroke width</Trans>}>
            <Groove
              ariaLabel={t`Stroke width`}
              wide
              value={String(WIDTHS.includes(style.strokeWidth) ? style.strokeWidth : '')}
              onChange={w => onStyle({ strokeWidth: Number(w) })}
              options={[
                { value: '2', label: <Named icon={<span className="wb__weight" style={{ height: 2 }} aria-hidden="true" />} name={t`Thin`} /> },
                { value: '4', label: <Named icon={<span className="wb__weight" style={{ height: 4 }} aria-hidden="true" />} name={t`Bold`} /> },
                { value: '8', label: <Named icon={<span className="wb__weight" style={{ height: 7 }} aria-hidden="true" />} name={t`Extra bold`} /> },
              ]}
            />
          </Section>
        )}
        {kinds.dash && (
          <Section label={<Trans>Stroke style</Trans>}>
            <Groove
              ariaLabel={t`Stroke style`}
              wide
              value={style.strokeStyle}
              onChange={strokeStyle => onStyle({ strokeStyle })}
              options={[
                { value: 'solid', label: <Named icon={<span className="wb__dash" aria-hidden="true" />} name={t`Solid line`} /> },
                { value: 'dashed', label: <Named icon={<span className="wb__dash wb__dash--dashed" aria-hidden="true" />} name={t`Dashed`} /> },
                { value: 'dotted', label: <Named icon={<span className="wb__dash wb__dash--dotted" aria-hidden="true" />} name={t`Dotted`} /> },
              ]}
            />
          </Section>
        )}
        {kinds.edges && (
          <Section label={<Trans>Edges</Trans>}>
            <Groove
              ariaLabel={t`Edges`}
              wide
              value={style.roundness}
              onChange={roundness => onStyle({ roundness })}
              options={[{ value: 'sharp', label: t`Sharp` }, { value: 'round', label: t`Round` }]}
            />
          </Section>
        )}
        {kinds.arrows && (
          <Section label={<Trans>Arrowheads</Trans>}>
            <Groove
              ariaLabel={t`Arrowheads`}
              wide
              value={style.startArrow ? (style.endArrow ? 'both' : 'start') : style.endArrow ? 'end' : 'none'}
              onChange={v => onStyle({ startArrow: v === 'start' || v === 'both', endArrow: v === 'end' || v === 'both' })}
              options={[
                { value: 'none', label: t`None` },
                { value: 'end', label: '→' },
                { value: 'start', label: '←' },
                { value: 'both', label: '↔' },
              ]}
            />
          </Section>
        )}
        {kinds.text && (
          <>
            <Section label={<Trans>Font size</Trans>}>
              <Groove
                ariaLabel={t`Font size`}
                wide
                value={String(FONT_SIZES.includes(style.fontSize) ? style.fontSize : '')}
                onChange={v => onStyle({ fontSize: Number(v) })}
                options={[{ value: '16', label: 'S' }, { value: '20', label: 'M' }, { value: '28', label: 'L' }, { value: '36', label: 'XL' }]}
              />
            </Section>
            <Section label={<Trans>Text align</Trans>}>
              <Groove
                ariaLabel={t`Text align`}
                wide
                value={style.textAlign}
                onChange={textAlign => onStyle({ textAlign })}
                options={[{ value: 'left', label: t`Left` }, { value: 'center', label: t`Centre` }, { value: 'right', label: t`Right` }]}
              />
            </Section>
          </>
        )}
        {kinds.opacity && <Section label={<Trans>Opacity</Trans>}>
          <input
            type="range"
            min={10}
            max={100}
            step={10}
            value={Math.round(style.opacity * 100)}
            onChange={e => onStyle({ opacity: Number(e.target.value) / 100 })}
            className="wb__range"
            aria-label={t`Opacity`}
          />
        </Section>}
      </>}

      {actions && (
        <>
          {!locked && <>
            <Section label={<Trans>Layers</Trans>}>
              <div className="wb__acts">
                <IconButton label={t`Send to back`} onClick={() => actions.onOrder('back')}><SendToBack className="icon" /></IconButton>
                <IconButton label={t`Send backward`} onClick={() => actions.onOrder('backward')}><ArrowDown className="icon" /></IconButton>
                <IconButton label={t`Bring forward`} onClick={() => actions.onOrder('forward')}><ArrowUp className="icon" /></IconButton>
                <IconButton label={t`Bring to front`} onClick={() => actions.onOrder('front')}><BringToFront className="icon" /></IconButton>
              </div>
            </Section>
            {actions.units > 1 && (
              <Section label={<Trans>Align</Trans>}>
                <div className="wb__acts">
                  <IconButton label={t`Align left`} onClick={() => actions.onAlign('left')}><AlignStartVertical className="icon" /></IconButton>
                  <IconButton label={t`Centre horizontally`} onClick={() => actions.onAlign('center')}><AlignCenterVertical className="icon" /></IconButton>
                  <IconButton label={t`Align right`} onClick={() => actions.onAlign('right')}><AlignEndVertical className="icon" /></IconButton>
                  <IconButton label={t`Align top`} onClick={() => actions.onAlign('top')}><AlignStartHorizontal className="icon" /></IconButton>
                  <IconButton label={t`Centre vertically`} onClick={() => actions.onAlign('middle')}><AlignCenterHorizontal className="icon" /></IconButton>
                  <IconButton label={t`Align bottom`} onClick={() => actions.onAlign('bottom')}><AlignEndHorizontal className="icon" /></IconButton>
                  {actions.units > 2 && <>
                    <IconButton label={t`Distribute horizontally`} onClick={() => actions.onDistribute('horizontal')}><AlignHorizontalDistributeCenter className="icon" /></IconButton>
                    <IconButton label={t`Distribute vertically`} onClick={() => actions.onDistribute('vertical')}><AlignVerticalDistributeCenter className="icon" /></IconButton>
                  </>}
                </div>
              </Section>
            )}
          </>}
          <Section label={<Trans>Actions</Trans>}>
            <div className="wb__acts">
              {!locked && <IconButton label={t`Duplicate`} onClick={actions.onDuplicate}><CopyPlus className="icon" /></IconButton>}
              {!locked && actions.canGroup && <IconButton label={t`Group`} onClick={actions.onGroup}><Group className="icon" /></IconButton>}
              {!locked && actions.canUngroup && <IconButton label={t`Ungroup`} onClick={actions.onUngroup}><Ungroup className="icon" /></IconButton>}
              {locked
                ? <IconButton label={t`Unlock`} onClick={() => actions.onLock(false)}><LockOpen className="icon" /></IconButton>
                : <IconButton label={t`Lock`} onClick={() => actions.onLock(true)}><Lock className="icon" /></IconButton>}
              {!locked && <IconButton label={t`Delete selection`} onClick={actions.onDelete}><Trash2 className="icon" /></IconButton>}
            </div>
          </Section>
        </>
      )}
    </div>
  );
};
