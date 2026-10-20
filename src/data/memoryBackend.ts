import type { DataSet, ID, Row, TableName } from "@/domain/types";
import { emptyDataSet } from "@/domain/types";
import type { Backend, NewRow } from "./backend";
import { ADMIN_ONLY_TABLES } from "./schema";

/** Keeps everything in memory. Used for demo mode (nothing is saved) and tests. */
export class MemoryBackend implements Backend {
  readonly kind = "memory" as const;
  private data: DataSet;
  private nextId = 1;

  constructor(initial: DataSet = emptyDataSet()) {
    this.data = structuredClone(initial);
    for (const rows of Object.values(this.data) as { id: ID }[][]) {
      for (const r of rows) this.nextId = Math.max(this.nextId, (Number(r.id) || 0) + 1);
    }
  }

  async load(): Promise<DataSet> {
    const out = structuredClone(this.data);
    for (const t of ADMIN_ONLY_TABLES) (out as unknown as Record<string, unknown[]>)[t] = [];
    return out;
  }

  async loadTable<K extends TableName>(table: K): Promise<Row<K>[]> {
    return structuredClone(this.data[table]) as Row<K>[];
  }

  async create<K extends TableName>(table: K, row: NewRow<K>): Promise<Row<K>> {
    const created = { ...structuredClone(row), id: String(this.nextId++) } as Row<K>;
    (this.data[table] as Row<K>[]).push(created);
    return structuredClone(created);
  }

  async update<K extends TableName>(table: K, id: ID, patch: Partial<Row<K>>): Promise<void> {
    const rows = this.data[table] as Row<K>[];
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(`Record ${id} was not found. Someone may have deleted it.`);
    rows[i] = { ...rows[i], ...structuredClone(patch), id };
  }

  async remove(table: TableName, id: ID): Promise<void> {
    const rows = this.data[table] as { id: ID }[];
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows.splice(i, 1);
  }

  async missingLists(): Promise<string[]> {
    return [];
  }

  async setup(): Promise<void> {}
}
