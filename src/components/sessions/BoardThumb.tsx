import React, { useId } from 'react';
import { t } from '@lingui/core/macro';
import type { WhiteboardElement, WhiteboardPoint, WhiteboardStrokeStyle } from '../../types';
import { formatDueDate } from './format';
import {
  boundsOfAll, diamondCorners, diamondRadius, elementBounds, isMoreShape, linePath, mindmapLinks, outlinePath, roundedPolygonPath, SECTION_TAB_HEIGHT, tableCellBox,
} from '../whiteboard/geometry';
import {
  fitNoteText, initials, lineHeightFor, MARKER_ALPHA, midpointOf, MINDMAP_FONT_SIZE, MINDMAP_PADDING, NOTE_INSET, NOTE_FOOT, NOTE_PADDING,
  PAGE_BAR, PAGE_EDGE, personInk, SECTION_FILL_DEFAULT, shapeText, STAMP_GLYPHS, TABLE_FONT_SIZE, TABLE_PADDING, TAPE_COLOR, TAPE_EDGE, TAPE_TILT,
  TASK_BOX, TASK_FONT_SIZE, TASK_FOOT, TASK_TEXT_X, taskLines,
} from '../whiteboard/draw';

// Room above the top for a section's name tab.
const PADDING = 32;

/** Colours the picture is drawn in: CSS variables on the page, real values in an exported file. */
export type SvgPaint = { board: string; ink: string; font: string };
const PAGE_PAINT: SvgPaint = { board: 'var(--color-whiteboard)', ink: 'var(--ink-black)', font: 'var(--font-display)' };

const dash = (style: WhiteboardStrokeStyle | undefined, width: number) =>
  style === 'dashed' ? `${width * 4 + 6} ${width * 3 + 6}` : style === 'dotted' ? `0.01 ${width * 2 + 5}` : undefined;

const arrowhead = (tip: WhiteboardPoint, from: WhiteboardPoint, width: number) => {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const length = Math.max(12, width * 4);
  const wing = (side: number) => `${tip.x - length * Math.cos(angle + side * 0.5)},${tip.y - length * Math.sin(angle + side * 0.5)}`;
  return `M${wing(-1)} L${tip.x},${tip.y} L${wing(1)}`;
};

let measuring: CanvasRenderingContext2D | null | undefined;
/** Text width as the canvas measures it, so a note breaks its lines the same in the picture as on the board. */
const measureWith = (font: string) => (run: string, size: number) => {
  if (measuring === undefined) measuring = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measuring) return run.length * size * 0.55;
  measuring.font = `500 ${size}px ${font}`;
  return measuring.measureText(run).width;
};

/** Words wrapped into a box, aligned across it and centred down it, as the canvas sets them; React escapes the text. */
const BoxText: React.FC<{
  box: { x: number; y: number; width: number; height: number }; text: string; paint: SvgPaint; pad: number;
  look: { fontSize: number; align: 'left' | 'center' | 'right'; color: string; weight: number };
}> = ({ box, text, paint, pad, look }) => (
  <foreignObject x={box.x} y={box.y} width={box.width} height={box.height}>
    {/* A standalone SVG file shows HTML only in its own namespace. */}
    <div {...{ xmlns: 'http://www.w3.org/1999/xhtml' }} style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: pad, height: '100%', boxSizing: 'border-box', overflow: 'hidden',
      font: `${look.weight} ${look.fontSize}px/${lineHeightFor(look.fontSize)}px ${paint.font}`, color: look.color, textAlign: look.align,
      whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    }}>
      {text}
    </div>
  </foreignObject>
);

const ElementSvg: React.FC<{ el: WhiteboardElement; paint: SvgPaint; pattern: string }> = ({ el, paint, pattern }) => {
  const opacity = el.opacity ?? undefined;
  if (el.type === 'stroke') {
    return (
      <polyline
        points={el.points.map(p => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={el.tool === 'eraser' ? paint.board : el.color}
        strokeWidth={el.size}
        strokeLinecap={el.tool === 'marker' ? 'butt' : 'round'}
        strokeLinejoin="round"
        opacity={el.tool === 'marker' ? (el.opacity ?? 1) * MARKER_ALPHA : opacity}
      />
    );
  }
  if (el.type === 'image') {
    return <image href={el.src} x={el.x} y={el.y} width={el.width} height={el.height} preserveAspectRatio="none" opacity={opacity} />;
  }
  if (el.type === 'html') {
    return (
      <g opacity={opacity}>
        <rect x={el.x} y={el.y} width={el.width} height={el.height} rx={8} fill="#ffffff" stroke={PAGE_EDGE} />
        <line x1={el.x} y1={el.y + PAGE_BAR} x2={el.x + el.width} y2={el.y + PAGE_BAR} stroke={PAGE_EDGE} />
        <text x={el.x + 12} y={el.y + PAGE_BAR / 2} dominantBaseline="central" fill={paint.ink} fontWeight={600} fontFamily={paint.font} fontSize={14}>{el.title || 'HTML'}</text>
      </g>
    );
  }
  if (el.type === 'stamp' && el.stamp === 'tape') {
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
    return (
      <rect x={el.x} y={el.y} width={el.width} height={el.height} fill={TAPE_COLOR} stroke={TAPE_EDGE} strokeWidth={0.75}
        transform={`rotate(${(TAPE_TILT * 180) / Math.PI} ${cx} ${cy})`} opacity={opacity} />
    );
  }
  if (el.type === 'stamp') {
    const r = Math.min(el.width, el.height) / 2;
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
    const glyph = STAMP_GLYPHS[el.stamp];
    const scale = (r * 1.05) / 24;
    const br = r * 0.42;
    return (
      <g opacity={opacity}>
        <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke="#cfc5bc" strokeWidth={0.5} />
        {glyph.path && (
          <path d={glyph.path} transform={`translate(${cx - 12 * scale} ${cy - 12 * scale}) scale(${scale})`}
            fill={glyph.fill ? glyph.color : 'none'} stroke={glyph.fill ? 'none' : glyph.color} strokeWidth={glyph.width} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {glyph.text && (
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill={glyph.color} fontWeight={700} fontFamily={paint.font} fontSize={glyph.text.length > 2 ? r * 0.55 : r * 0.8}>{glyph.text}</text>
        )}
        {el.by && (
          <g>
            <circle cx={el.x + el.width - br * 0.6} cy={el.y + el.height - br * 0.6} r={br} fill={personInk(el.by)} stroke="#ffffff" strokeWidth={2} />
            <text x={el.x + el.width - br * 0.6} y={el.y + el.height - br * 0.6} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontWeight={600} fontFamily={paint.font} fontSize={br * 0.85}>{initials(el.by)}</text>
          </g>
        )}
      </g>
    );
  }
  if (el.type === 'shape' && el.shapeType === 'table') {
    const b = elementBounds(el);
    const cells = el.cells ?? [['']];
    const head = tableCellBox(el, 0, 0);
    return (
      <g opacity={opacity}>
        <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="#ffffff" />
        {el.fillColor !== 'transparent' && <rect x={b.x} y={b.y} width={b.width} height={head.height} fill={el.fillColor} />}
        <path
          d={[
            ...cells.map((_, r) => `M${b.x} ${b.y + (b.height * r) / cells.length}H${b.x + b.width}`),
            `M${b.x} ${b.y + b.height}H${b.x + b.width}`,
            ...cells[0].map((_, c) => `M${b.x + (b.width * c) / cells[0].length} ${b.y}V${b.y + b.height}`),
            `M${b.x + b.width} ${b.y}V${b.y + b.height}`,
          ].join('')}
          fill="none" stroke={el.strokeColor} strokeWidth={Math.max(1, el.strokeWidth)} strokeLinecap="square"
        />
        {cells.flatMap((row, r) => row.map((cell, c) => cell && (
          <BoxText key={`${r}-${c}`} box={tableCellBox(el, r, c)} text={cell} paint={paint} pad={TABLE_PADDING}
            look={{ fontSize: el.fontSize ?? TABLE_FONT_SIZE, align: el.textAlign ?? 'left', color: paint.ink, weight: r === 0 ? 600 : 400 }} />
        )))}
      </g>
    );
  }
  if (el.type === 'shape' && el.shapeType === 'mindmap') {
    const b = elementBounds(el);
    const root = !el.parent;
    return (
      <g opacity={opacity}>
        <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={Math.min(b.height / 2, 24)}
          fill={root ? el.strokeColor : el.fillColor === 'transparent' ? '#ffffff' : el.fillColor} stroke={el.strokeColor} strokeWidth={Math.max(1, el.strokeWidth)} />
        {el.text && <BoxText box={b} text={el.text} paint={paint} pad={MINDMAP_PADDING}
          look={{ fontSize: el.fontSize ?? MINDMAP_FONT_SIZE, align: el.textAlign ?? 'center', color: root ? '#ffffff' : paint.ink, weight: root ? 600 : 500 }} />}
      </g>
    );
  }
  if (el.type === 'shape' && el.shapeType === 'note') {
    const b = elementBounds(el);
    const fit = el.text ? fitNoteText(el.text, b.width - 2 * NOTE_INSET, b.height - 2 * NOTE_INSET - NOTE_FOOT, measureWith(paint.font)) : null;
    return (
      <g opacity={opacity}>
        <rect x={b.x} y={b.y + 3} width={b.width} height={b.height} rx={3} fill="rgba(40, 30, 20, 0.12)" />
        <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={3} fill={el.fillColor === 'transparent' ? '#fbe7b0' : el.fillColor} />
        {fit && (
          <text fill={paint.ink} fontFamily={paint.font} fontWeight={500} fontSize={fit.fontSize} dominantBaseline="hanging" style={{ whiteSpace: 'pre' }}>
            {fit.lines.map((line, i) => <tspan key={i} x={b.x + NOTE_INSET} y={b.y + NOTE_INSET + i * fit.lineHeight}>{line}</tspan>)}
          </text>
        )}
        {el.by && <text x={b.x + NOTE_INSET} y={b.y + b.height - 10} fill={paint.ink} opacity={0.6} fontFamily={paint.font} fontWeight={500} fontSize={12}>{el.by}</text>}
      </g>
    );
  }
  if (el.type === 'shape' && el.shapeType === 'task') {
    const b = elementBounds(el);
    const measure = measureWith(paint.font);
    const lines = el.text ? taskLines(el.text, b.width, b.height, run => measure(run, TASK_FONT_SIZE)) : [];
    const foot = b.y + b.height - TASK_FOOT / 2 - 2;
    return (
      <g opacity={opacity}>
        <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={8} fill="#ffffff" stroke="rgba(24, 24, 27, 0.16)" />
        <rect x={b.x + TASK_BOX.x} y={b.y + TASK_BOX.y} width={TASK_BOX.size} height={TASK_BOX.size} rx={5} fill={el.done ? paint.ink : 'none'} stroke={paint.ink} strokeWidth={1.75} />
        {el.done && <path d={`M${b.x + TASK_BOX.x + 5} ${b.y + TASK_BOX.y + 10.5}l3.5 3.5 6.5-7.5`} fill="none" stroke="#ffffff" strokeWidth={2} />}
        <text fill={paint.ink} fontFamily={paint.font} fontWeight={500} fontSize={TASK_FONT_SIZE} dominantBaseline="hanging" opacity={el.done ? 0.55 : 1} textDecoration={el.done ? 'line-through' : undefined} style={{ whiteSpace: 'pre' }}>
          {lines.map((line, i) => <tspan key={i} x={b.x + TASK_TEXT_X} y={b.y + TASK_BOX.y + 1 + i * lineHeightFor(TASK_FONT_SIZE)}>{line}</tspan>)}
        </text>
        {el.owner && (
          <g>
            <circle cx={b.x + 27} cy={foot} r={11} fill={personInk(el.owner)} />
            <text x={b.x + 27} y={foot} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontWeight={600} fontFamily={paint.font} fontSize={10}>{initials(el.owner)}</text>
            <text x={b.x + 44} y={foot} dominantBaseline="central" fill={paint.ink} fontWeight={500} fontFamily={paint.font} fontSize={13}>{el.owner}</text>
          </g>
        )}
        {el.due && <text x={b.x + b.width - 16} y={foot} textAnchor="end" dominantBaseline="central" fill={paint.ink} fontWeight={500} fontFamily={paint.font} fontSize={13}>{formatDueDate(el.due)}</text>}
      </g>
    );
  }
  if (el.type === 'shape' && el.shapeType === 'section') {
    const b = elementBounds(el);
    const name = el.text?.trim();
    return (
      <g opacity={opacity}>
        <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={12} fill={el.fillColor === 'transparent' ? SECTION_FILL_DEFAULT : el.fillColor} stroke="rgba(24, 24, 27, 0.18)" />
        {name && (
          <g>
            <rect x={b.x} y={b.y - SECTION_TAB_HEIGHT} width={Math.min(b.width, name.length * 8 + 20)} height={SECTION_TAB_HEIGHT - 4} rx={8} fill={paint.ink} />
            <text x={b.x + 10} y={b.y - SECTION_TAB_HEIGHT / 2 - 1} dominantBaseline="central" fill="#ffffff" fontWeight={600} fontFamily={paint.font} fontSize={14}>{name}</text>
          </g>
        )}
      </g>
    );
  }
  if (el.type === 'line') {
    const pts = linePath(el);
    const at = el.label ? midpointOf(pts) : null;
    return (
      <g fill="none" stroke={el.strokeColor} strokeWidth={el.strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity={opacity}>
        <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} strokeDasharray={dash(el.strokeStyle, el.strokeWidth)} />
        {el.endArrow && pts.length > 1 && <path d={arrowhead(pts[pts.length - 1], pts[pts.length - 2], el.strokeWidth)} />}
        {el.startArrow && pts.length > 1 && <path d={arrowhead(pts[0], pts[1], el.strokeWidth)} />}
        {at && (
          <g>
            <rect x={at.x - (el.label!.length * 7.5 + 20) / 2} y={at.y - 12} width={el.label!.length * 7.5 + 20} height={24} rx={12} fill="#ffffff" strokeWidth={1.5} />
            <text x={at.x} y={at.y} textAnchor="middle" dominantBaseline="central" fill={paint.ink} stroke="none" fontWeight={600} fontFamily={paint.font} fontSize={14}>{el.label}</text>
          </g>
        )}
      </g>
    );
  }
  if (el.type === 'text') {
    const align = el.textAlign ?? 'left';
    const x = align === 'center' ? el.x + el.width / 2 : align === 'right' ? el.x + el.width : el.x;
    return (
      <text
        x={x}
        y={el.y}
        fill={el.color}
        fontSize={el.fontSize}
        fontFamily={paint.font}
        textAnchor={align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'}
        dominantBaseline="hanging"
        opacity={opacity}
        style={{ whiteSpace: 'pre' }}
      >
        {el.text.split('\n').map((line, i) => <tspan key={i} x={x} y={el.y + i * lineHeightFor(el.fontSize)}>{line}</tspan>)}
      </text>
    );
  }
  const b = elementBounds(el);
  const hatched = el.fillColor !== 'transparent' && (el.fillStyle === 'hachure' || el.fillStyle === 'cross-hatch');
  const fill = el.fillColor === 'transparent' ? 'none' : hatched ? `url(#${pattern})` : el.fillColor;
  const common = { fill, stroke: el.strokeWidth > 0 ? el.strokeColor : 'none', strokeWidth: el.strokeWidth, strokeDasharray: dash(el.strokeStyle, el.strokeWidth), strokeLinejoin: 'round' as const };
  const gap = Math.max(6, el.strokeWidth * 4 + 4);
  return (
    <g opacity={opacity}>
      {hatched && (
        <defs>
          <pattern id={pattern} patternUnits="userSpaceOnUse" width={gap} height={gap} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={gap} stroke={el.fillColor} strokeWidth={Math.max(1, el.strokeWidth / 2)} />
            {el.fillStyle === 'cross-hatch' && <line x1={0} y1={0} x2={gap} y2={0} stroke={el.fillColor} strokeWidth={Math.max(1, el.strokeWidth / 2)} />}
          </pattern>
        </defs>
      )}
      {isMoreShape(el.shapeType)
        ? <path d={outlinePath(el.shapeType, b)} {...common} />
        : el.shapeType === 'circle'
        ? <ellipse cx={b.x + b.width / 2} cy={b.y + b.height / 2} rx={b.width / 2} ry={b.height / 2} {...common} />
        : el.shapeType === 'diamond'
          ? <path d={roundedPolygonPath(diamondCorners(b), el.roundness === 'round' ? diamondRadius(b) : 0)} {...common} />
          : <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={el.roundness === 'round' ? Math.min(32, Math.min(b.width, b.height) * 0.25) : undefined} {...common} />}
      {el.text && <BoxText box={b} text={el.text} paint={paint} pad={NOTE_PADDING} look={shapeText(el, paint)} />}
    </g>
  );
};

/** A board as one SVG, fitted to its content. Null when there is nothing on it. */
export const BoardSvg: React.FC<{ elements: WhiteboardElement[]; paint?: SvgPaint; label?: string; background?: boolean }> = ({ elements, paint = PAGE_PAINT, label, background }) => {
  const prefix = useId().replace(/:/g, '');
  const box = boundsOfAll(elements);
  if (!box) return null;
  const x = box.x - PADDING, y = box.y - PADDING;
  const width = Math.max(1, box.width) + PADDING * 2;
  const height = Math.max(1, box.height) + PADDING * 2;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${x} ${y} ${width} ${height}`} width={background ? width : undefined} height={background ? height : undefined} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label ?? t`Whiteboard`}>
      {background && <rect x={x} y={y} width={width} height={height} fill={paint.board} />}
      {mindmapLinks(elements).map((link, i) => (
        <path key={`link-${i}`} d={`M${link.from.x} ${link.from.y}C${link.c1.x} ${link.c1.y} ${link.c2.x} ${link.c2.y} ${link.to.x} ${link.to.y}`}
          fill="none" stroke={link.color} strokeWidth={2} strokeLinecap="round" opacity={link.opacity} />
      ))}
      {elements.map((el, index) => <ElementSvg key={el.id ?? index} el={el} paint={paint} pattern={`${prefix}-h${index}`} />)}
    </svg>
  );
};

/**
 * A board as a picture: the same strokes and shapes the canvas draws, fitted into one frame.
 * The board is light in both modes, so the sheet behind it reads the whiteboard token.
 */
export const BoardThumb: React.FC<{ elements: WhiteboardElement[]; large?: boolean; label?: string }> = ({ elements, large = false, label }) => {
  if (!boundsOfAll(elements)) {
    return <div className={`thumb ${large ? 'thumb--l' : ''}`}><span className="thumb__empty">{t`This board is empty`}</span></div>;
  }
  return (
    <div className={`thumb ${large ? 'thumb--l' : ''}`}>
      <BoardSvg elements={elements} label={label} />
    </div>
  );
};
