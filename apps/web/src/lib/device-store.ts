import { configureEngine } from "../../../mobile/src/local/repository";
import type { Row, Table } from "../../../mobile/src/local/schema";

type Database = Partial<Record<Table, Row[]>>;
const key = "feeflow.browser-workspace.v1";
let transaction: Database | undefined;
let queue = Promise.resolve();

function read(): Database {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as Database) : {};
}

export function openDeviceStore() {
  configureEngine({
    all: async (table) => structuredClone((transaction ?? read())[table] ?? []),
    put: async (table, row) => {
      if (!transaction) throw new Error("Write requires a transaction.");
      const rows = (transaction[table] ?? []).filter(
        (existing) => existing.id !== row.id,
      );
      transaction[table] = [...rows, structuredClone(row)];
    },
    clear: async (table) => {
      if (!transaction) throw new Error("Write requires a transaction.");
      transaction[table] = [];
    },
    id: () => crypto.randomUUID(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    tx: <T>(task: () => Promise<T>) => {
      async function commit() {
        transaction = read();
        try {
          const result = await task();
          localStorage.setItem(key, JSON.stringify(transaction));
          return result;
        } finally {
          transaction = undefined;
        }
      }
      const result = queue.then(async () => {
        let value!: T;
        await navigator.locks.request(key, async () => {
          value = await commit();
        });
        return value;
      });
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  });
  if (!navigator.locks || !crypto.randomUUID)
    throw new Error(
      "Open Feeflow over HTTPS in a browser that supports local storage.",
    );
  return Boolean(read().users?.length);
}

type DeviceSession = {
  token: string;
  cloud: Awaited<
    ReturnType<typeof import("../../../mobile/src/local/cloud").unlockCloud>
  >;
};
let session: DeviceSession | undefined;
export const getDeviceSession = () => session;
export function setDeviceSession(value?: DeviceSession) {
  session = value;
}
