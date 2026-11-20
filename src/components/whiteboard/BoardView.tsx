import React from 'react';
import { t } from '@lingui/core/macro';
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react';
import type { Spec } from '@json-render/core';
import { viewCatalog } from './viewCatalog';

const { registry } = defineRegistry(viewCatalog, {
  components: {
    Stack: ({ props, children }) => <div className={`bv-stack bv-stack--${props.direction ?? 'column'} bv-gap--${props.gap ?? 'md'}`}>{children}</div>,
    Grid: ({ props, children }) => <div className="bv-grid" style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }}>{children}</div>,
    Card: ({ props, children }) => (
      <section className="bv-card">
        {props.title && <h3 className="bv-card__title">{props.title}</h3>}
        {children}
      </section>
    ),
    Heading: ({ props }) => {
      const Tag = (['h1', 'h2', 'h3'] as const)[(props.level ?? 2) - 1];
      return <Tag className={`bv-h bv-h--${props.level ?? 2}`}>{props.text}</Tag>;
    },
    Text: ({ props }) => <p className={`bv-text ${props.muted ? 'bv-text--muted' : ''}`}>{props.text}</p>,
    List: ({ props }) => {
      const Tag = props.ordered ? 'ol' : 'ul';
      return <Tag className="bv-list">{props.items.map((item, i) => <li key={i}>{item}</li>)}</Tag>;
    },
    Checklist: ({ props }) => (
      <ul className="bv-checks">
        {props.items.map((item, i) => (
          <li key={i} className={item.done ? 'is-done' : ''}>
            <span className="bv-box" aria-label={item.done ? t`Done` : t`Open`}>{item.done ? '✓' : ''}</span>{item.text}
          </li>
        ))}
      </ul>
    ),
    Table: ({ props }) => (
      <table className="bv-table">
        <thead><tr>{props.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{props.rows.map((row, r) => <tr key={r}>{props.columns.map((_, i) => <td key={i}>{row[i] ?? ''}</td>)}</tr>)}</tbody>
      </table>
    ),
    Stat: ({ props }) => (
      <div className="bv-stat">
        <span className="bv-stat__label">{props.label}</span>
        <span className="bv-stat__value fig">{props.value}</span>
        {props.note && <span className="bv-stat__note">{props.note}</span>}
      </div>
    ),
    Progress: ({ props }) => (
      <div className="bv-progress">
        <span className="bv-progress__label">{props.label}<span className="fig">{Math.round(props.value)} %</span></span>
        <span className="bv-progress__track"><span style={{ width: `${props.value}%` }} /></span>
      </div>
    ),
    Badge: ({ props }) => <span className="bv-badge">{props.text}</span>,
    Timeline: ({ props }) => (
      <ol className="bv-timeline">
        {props.items.map((item, i) => (
          <li key={i}>
            <span className="bv-timeline__when fig">{item.when}</span>
            <span className="bv-timeline__title">{item.title}</span>
            {item.text && <span className="bv-timeline__text">{item.text}</span>}
          </li>
        ))}
      </ol>
    ),
    Divider: () => <hr className="bv-divider" />,
  },
});

/** An overview the assistant built, drawn with the board's own parts. Nothing in it runs or loads. */
export const BoardView: React.FC<{ spec: string; title: string }> = ({ spec, title }) => {
  const parsed = React.useMemo(() => { try { return JSON.parse(spec) as Spec; } catch { return null; } }, [spec]);
  return (
    <div className="bv" role="document" aria-label={title}>
      <JSONUIProvider registry={registry}>
        <Renderer spec={parsed} registry={registry} />
      </JSONUIProvider>
    </div>
  );
};
