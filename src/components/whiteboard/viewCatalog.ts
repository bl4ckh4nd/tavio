// The parts an overview on the board is built from (json-render). The assistant writes a spec of these;
// the server checks it against this catalog, and the board draws it with its own components. Pure: no React.
import { defineCatalog, validateSpec } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';

const line = z.string().max(300);
const words = z.string().max(2000);

export const viewCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({ direction: z.enum(['column', 'row']).optional(), gap: z.enum(['sm', 'md', 'lg']).optional() }),
      description: 'Lays its children one below the other, or side by side with direction "row".',
    },
    Grid: {
      props: z.object({ columns: z.number().int().min(1).max(4) }),
      description: 'Lays its children in equal columns.',
    },
    Card: {
      props: z.object({ title: line.optional() }),
      description: 'A framed group with an optional title.',
    },
    Heading: {
      props: z.object({ text: line, level: z.number().int().min(1).max(3).optional() }),
      description: 'A heading; level 1 is the largest.',
    },
    Text: {
      props: z.object({ text: words, muted: z.boolean().optional() }),
      description: 'A paragraph.',
    },
    List: {
      props: z.object({ items: z.array(line).max(30), ordered: z.boolean().optional() }),
      description: 'A bulleted or numbered list.',
    },
    Checklist: {
      props: z.object({ items: z.array(z.object({ text: line, done: z.boolean() })).max(30) }),
      description: 'Items with a done or open mark.',
    },
    Table: {
      props: z.object({ columns: z.array(line).min(1).max(8), rows: z.array(z.array(line).max(8)).max(40) }),
      description: 'A table with a header row.',
    },
    Stat: {
      props: z.object({ label: line, value: line, note: line.optional() }),
      description: 'One key figure with its label.',
    },
    Progress: {
      props: z.object({ label: line, value: z.number().min(0).max(100) }),
      description: 'A bar filled to value percent.',
    },
    Badge: {
      props: z.object({ text: z.string().max(40) }),
      description: 'A short status word in an outline.',
    },
    Timeline: {
      props: z.object({ items: z.array(z.object({ when: z.string().max(60), title: line, text: line.optional() })).max(20) }),
      description: 'Dated steps in order.',
    },
    Divider: {
      props: z.object({}),
      description: 'A thin rule between parts.',
    },
  },
  actions: {},
});

const MAX_SPEC = 60_000;
const MAX_PARTS = 200;

/** The spec if it is one the board can draw, or the reason it is not. */
export const checkView = (spec: unknown): { ok: true; spec: unknown } | { ok: false; reason: string } => {
  const size = JSON.stringify(spec ?? null).length;
  if (size > MAX_SPEC) return { ok: false, reason: `too large (at most ${MAX_SPEC / 1000} KB)` };
  const parsed = viewCatalog.validate(spec);
  if (!parsed.success || !parsed.data) {
    const issue = parsed.error?.issues[0];
    return { ok: false, reason: issue ? `${issue.path.join('.')}: ${issue.message}` : 'not a spec' };
  }
  const elements = (parsed.data as { elements: Record<string, unknown> }).elements;
  if (Object.keys(elements).length > MAX_PARTS) return { ok: false, reason: `more than ${MAX_PARTS} parts` };
  // Each part's props against its own schema; the catalog check above only checks the shape of the spec.
  const parts = viewCatalog.data.components as Record<string, { props: z.ZodType }>;
  for (const [key, element] of Object.entries(elements as Record<string, { type: string; props?: unknown }>)) {
    const part = parts[element.type];
    if (!part) return { ok: false, reason: `${key}: there is no part called ${element.type}` };
    const props = part.props.safeParse(element.props ?? {});
    if (!props.success) return { ok: false, reason: `${key}.${props.error.issues[0].path.join('.')}: ${props.error.issues[0].message}` };
  }
  const structure = validateSpec(parsed.data as never);
  if (!structure.valid) return { ok: false, reason: structure.issues.map(i => i.message).join('; ') };
  return { ok: true, spec: parsed.data };
};
