/**
 * A small in-memory stand-in for the Convex database, enough for handlers that read through
 * indexes with eq/gt/gte/lt/lte. Index names are ignored; the conditions are applied as filters.
 */
type Row = Record<string, any> & { _id: string };
type Condition = { field: string; op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; value: any };

const matches = (row: Row, conditions: Condition[]) =>
  conditions.every(({ field, op, value }) => {
    const actual = row[field];
    if (op === 'eq') return actual === value;
    if (actual === undefined) return false;
    if (op === 'gt') return actual > value;
    if (op === 'gte') return actual >= value;
    if (op === 'lt') return actual < value;
    return actual <= value;
  });

const withoutUndefined = (value: Record<string, any>) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

export const createFakeDb = (seed: Record<string, Array<Record<string, any>>> = {}) => {
  const tables = new Map<string, Row[]>();
  let counter = 0;
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  for (const [name, rows] of Object.entries(seed)) {
    for (const row of rows) table(name).push({ _id: row._id ?? `${name}:${++counter}`, ...row } as Row);
  }

  const locate = (id: string) => {
    for (const rows of tables.values()) {
      const index = rows.findIndex((row) => row._id === id);
      if (index >= 0) return { rows, index };
    }
    return null;
  };

  const db = {
    // Like Convex: any well-formed id of that table, whether the row exists or not.
    normalizeId: (name: string, id: string) => (id.startsWith(`${name}:`) ? id : null),
    get: async (id: string) => {
      const found = locate(id);
      return found ? found.rows[found.index] : null;
    },
    insert: async (name: string, value: Record<string, any>) => {
      const _id = `${name}:${++counter}`;
      table(name).push({ _id, _creationTime: Date.now(), ...withoutUndefined(value) });
      return _id;
    },
    patch: async (id: string, patch: Record<string, any>) => {
      const found = locate(id);
      if (!found) throw new Error(`patch: no document ${id}`);
      const next = { ...found.rows[found.index] };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      found.rows[found.index] = next;
    },
    delete: async (id: string) => {
      const found = locate(id);
      if (found) found.rows.splice(found.index, 1);
    },
    query: (name: string) => {
      const conditions: Condition[] = [];
      const builder: any = {};
      for (const op of ['eq', 'gt', 'gte', 'lt', 'lte'] as const) {
        builder[op] = (field: string, value: any) => {
          conditions.push({ field, op, value });
          return builder;
        };
      }
      const run = () => table(name).filter((row) => matches(row, conditions));
      const result: any = {
        withIndex: (_index: string, cb?: (q: any) => any) => {
          cb?.(builder);
          return result;
        },
        order: () => result,
        collect: async () => run(),
        first: async () => run()[0] ?? null,
        take: async (n: number) => run().slice(0, n),
      };
      return result;
    },
  };

  return { db, rows: (name: string) => table(name) };
};

export const createFakeCtx = (
  seed: Record<string, Array<Record<string, any>>> = {},
  identity: { subject: string } | null = { subject: 'member-1' },
) => {
  const fake = createFakeDb(seed);
  const deletedFiles: string[] = [];
  return {
    ...fake,
    auth: { getUserIdentity: async () => identity },
    storage: { delete: async (id: string) => { deletedFiles.push(id); }, getUrl: async (id: string) => `https://files.test/${id}` },
    deletedFiles,
  };
};
