import { configureEngine } from "./repository";
import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { TABLES, Table, Row, Snapshot, validateSnapshot } from "./schema";
import { hex } from "./crypto";
let db: SQLite.SQLiteDatabase;
let ready: Promise<void> | undefined;
let chain = Promise.resolve();
export const id = () => Crypto.randomUUID();
export function init() {
  return (ready ??= open());
}
async function open() {
  let key = await SecureStore.getItemAsync("feeflow.local-db-key.v1");
  if (!key) {
    key = hex(Crypto.getRandomBytes(32));
    await SecureStore.setItemAsync("feeflow.local-db-key.v1", key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  db = await SQLite.openDatabaseAsync("feeflow-local-v1.db");
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  const cipher = await db.getFirstAsync("PRAGMA cipher_version");
  if (!cipher)
    throw new Error(
      "This app requires the encrypted native Android build. Expo Go is not supported.",
    );
  await db.execAsync("PRAGMA journal_mode=WAL;");
  for (const table of TABLES)
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);`,
    );
  configureEngine({
    clear:async table=>{await db.runAsync(`DELETE FROM "${table}"`);}, all, put, tx, id, randomBytes: Crypto.getRandomBytes });
}
export async function all(table: Table): Promise<Row[]> {
  await init();
  return (
    await db.getAllAsync<{ data: string }>(`SELECT data FROM "${table}"`)
  ).map((r) => JSON.parse(r.data));
}
export async function put(table: Table, row: Row) {
  await db.runAsync(
    `INSERT OR REPLACE INTO "${table}"(id,data) VALUES(?,?)`,
    row.id,
    JSON.stringify(row),
  );
}
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  await init();
  let release!: () => void;
  const previous = chain;
  chain = new Promise((r) => (release = r));
  await previous;
  try {
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await fn();
    });
    return result;
  } finally {
    release();
  }
}
