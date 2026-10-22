// Storage interface. The app talks to SharePoint Lists in production and to an in-memory
// copy in demo mode and tests; both implement this.

import type { DataSet, ID, Row, TableName } from "@/domain/types";

export type NewRow<K extends TableName> = Omit<Row<K>, "id">;

export interface Backend {
  readonly kind: "memory" | "sharepoint";
  /** Everything except the admin-only lists (see ADMIN_ONLY_TABLES). */
  load(): Promise<DataSet>;
  /** One list's rows. Used for the admin-only lists. */
  loadTable<K extends TableName>(table: K): Promise<Row<K>[]>;
  create<K extends TableName>(table: K, row: NewRow<K>): Promise<Row<K>>;
  /** Writes only the fields given. */
  update<K extends TableName>(table: K, id: ID, patch: Partial<Row<K>>): Promise<void>;
  remove(table: TableName, id: ID): Promise<void>;
  /** Lists (by display name) that setup still needs to create. Empty when ready. */
  missingLists(): Promise<string[]>;
  /** Columns a newer version of the app added that setup has not created yet, as "List: Column, ...". */
  missingColumns(): Promise<string[]>;
  /** Creates any missing lists and columns. */
  setup(): Promise<void>;
}
