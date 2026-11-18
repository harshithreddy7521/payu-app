import type { Row, Table } from "./schema";
export type Engine = {
  clear:(table:Table)=>Promise<void>;
  all: (table: Table) => Promise<Row[]>;
  put: (table: Table, row: Row) => Promise<void>;
  tx: <T>(fn: () => Promise<T>) => Promise<T>;
  id: () => string;
  randomBytes: (n: number) => Uint8Array;
};
let engine: Engine;
export function configureEngine(value: Engine) {
  engine = value;
}
function get() {
  if (!engine) throw new Error("Local database is not ready.");
  return engine;
}
export const all = (table: Table) => get().all(table);
export const put = (table: Table, row: Row) => get().put(table, row);
export const tx = <T>(fn: () => Promise<T>) => get().tx(fn);
export const id = () => get().id();
export const randomBytes = (n: number) => get().randomBytes(n);

export const clear=(table:Table)=>get().clear(table);
