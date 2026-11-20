import { account, checkPassword, setup } from "./api";
import { seal, unseal } from "./crypto";
import { all, clear, id, put, randomBytes, tx } from "./repository";
import { TABLES, type Snapshot, validateSnapshot } from "./schema";
import { validateSchool, type SchoolProfile } from "./onboarding";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export type CloudInput = {
  spreadsheetId: string;
  credentials: string;
  passphrase: string;
  restoreId?: string;
};
type CloudConnection = {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
  passphrase: string;
  workspaceId: string;
};
const runtimeOrigin = () =>
  typeof window !== "undefined" && /^https?:$/.test(window.location?.protocol)
    ? window.location.origin
    : process.env.EXPO_PUBLIC_WEB_URL;

export function cloudEndpoint() {
  const value = runtimeOrigin();
  if (!value) return "";
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return "";
  }
  if (origin.username || origin.password) return "";
  const browserDevelopment =
    typeof window !== "undefined" &&
    window.location?.origin === origin.origin &&
    ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !browserDevelopment) return "";
  return new URL("/api/drive-sync", origin).href;
}

async function relay(
  connection: CloudConnection,
  action: "read" | "download" | "append" | "connect",
  revision?: string,
  snapshot?: string,
  parent?: string,
) {
  const endpoint = cloudEndpoint();
  if (!endpoint)
    throw new Error("Set the HTTPS Feeflow web URL to connect Google Drive.");
  const { passphrase: _passphrase, ...credentials } = connection;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...credentials,
        action,
        revision,
        snapshot,
        parent,
      }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.message || "Google Drive sync failed.");
    return data as { revision: string | null; snapshot?: string };
  } finally {
    clearTimeout(timeout);
  }
}

export async function registerSchool(
  name: string,
  email: string,
  password: string,
  profile: SchoolProfile,
  input: CloudInput,
) {
  if (profile.storage === "local") return setup(name, email, password, profile);
  if (input.passphrase.length < 12)
    throw new Error(
      "Enter a cloud backup passphrase of at least 12 characters.",
    );
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(input.credentials);
  } catch {
    throw new Error("Paste the Google service-account JSON key.");
  }
  if (
    serviceAccount?.type !== "service_account" ||
    typeof serviceAccount.client_email !== "string" ||
    typeof serviceAccount.private_key !== "string" ||
    !/^[\w-]{20,150}$/.test(input.spreadsheetId.trim())
  )
    throw new Error(
      "Enter a spreadsheet ID and a valid Google service-account JSON key.",
    );
  const restoreId = input.restoreId?.trim();
  if (!restoreId) validateSchool(profile);
  if (restoreId && !/^[a-f0-9-]{36}$/i.test(restoreId))
    throw new Error("Enter a valid cloud workspace ID.");
  if (password.length < 10)
    throw new Error("Use an administrator password of at least 10 characters.");
  const connection: CloudConnection = {
    spreadsheetId: input.spreadsheetId.trim(),
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
    passphrase: input.passphrase,
    workspaceId: restoreId || id(),
  };
  const envelope = await seal(
    connection,
    password,
    randomBytes(16),
    randomBytes(12),
    10,
  );
  const recoveryEnvelope = await seal(
    connection,
    input.passphrase,
    randomBytes(16),
    randomBytes(12),
  );
  if (!restoreId) {
    await relay(connection, "connect");
    await setup(name, email, password, profile, {
      envelope,
      recoveryEnvelope,
      workspaceId: connection.workspaceId,
    });
    return;
  }
  await relay(connection, "connect");
  const remote = await relay(connection, "download");
  const snapshot = await decodeSnapshot(remote, connection);
  const owner = snapshot.tables.users.find(
    (user) =>
      user.email === email.trim().toLowerCase() &&
      user.role === "OWNER" &&
      user.active,
  );
  if (!owner || !(await checkPassword(owner, password)))
    throw new Error(
      "Enter the cloud workspace administrator’s email and password.",
    );
  await tx(async () => {
    if ((await all("users")).length)
      throw new Error("This device is already configured.");
    await replaceSnapshot(snapshot);
    await put("settings", {
      id: "cloud-credentials",
      envelope,
      recoveryEnvelope,
      workspaceId: connection.workspaceId,
    });
    await remember(connection, remote.revision!);
  });
}

export async function unlockCloud(token: string, password: string) {
  const user = await account(token);
  if (user.role !== "OWNER") return undefined;
  const settings = await all("settings");
  if (settings.find((row) => row.id === "business")?.storage !== "cloud")
    return undefined;
  const credentials = settings.find((row) => row.id === "cloud-credentials");
  if (!credentials) return undefined;
  const connection = (await unseal(
    credentials.envelope,
    password,
  )) as CloudConnection;
  if (!credentials.recoveryEnvelope) {
    const recoveryEnvelope = await seal(
      connection,
      connection.passphrase,
      randomBytes(16),
      randomBytes(12),
    );
    await tx(async () => {
      const latest = (await all("settings")).find(
        (row) => row.id === credentials.id,
      );
      if (latest?.envelope === credentials.envelope)
        await put("settings", {
          ...latest,
          id: credentials.id,
          recoveryEnvelope,
        });
    });
  }
  return connection;
}

let syncing: Promise<string> | undefined;
export function syncCloud(connection: CloudConnection) {
  return (syncing ??= runSync(connection).finally(() => {
    syncing = undefined;
  }));
}

async function readSnapshot() {
  const tables = {} as Snapshot["tables"];
  for (const table of TABLES) {
    const rows = await all(table);
    tables[table] = (
      table === "settings"
        ? rows.filter((row) => syncSetting(row.id))
        : table === "audit"
          ? rows.filter((row) => row.action !== "LOGIN")
          : rows
    ).sort((a, b) => a.id.localeCompare(b.id));
  }
  return validateSnapshot({ version: 1, tables });
}

const fingerprint = (snapshot: Snapshot) =>
  bytesToHex(sha256(utf8ToBytes(JSON.stringify(snapshot))));

async function decodeSnapshot(
  remote: { revision: string | null; snapshot?: string },
  connection: CloudConnection,
) {
  if (!remote.revision || !remote.snapshot)
    throw new Error("No backup was found for this cloud workspace.");
  const snapshot = validateSnapshot(
    await unseal(remote.snapshot, connection.passphrase),
  );
  if (
    fingerprint(snapshot) !== remote.revision ||
    snapshot.tables.settings.some((row) => !syncSetting(row.id)) ||
    snapshot.tables.settings.find((row) => row.id === "business")?.storage !==
      "cloud"
  )
    throw new Error("The cloud backup failed validation.");
  return snapshot;
}

function syncSetting(key: string) {
  return (
    key === "business" ||
    key === "reminder-settings" ||
    key.startsWith("reminder-handoff:")
  );
}

async function replaceSnapshot(snapshot: Snapshot) {
  for (const table of TABLES) {
    const retained =
      table === "settings"
        ? (await all(table)).filter((row) => !syncSetting(row.id))
        : [];
    await clear(table);
    for (const row of retained) await put(table, row);
    for (const row of snapshot.tables[table]) await put(table, row);
  }
}

async function runSync(connection: CloudConnection) {
  const { state, snapshot } = await tx(async () => {
    await checkWorkspace(connection);
    return {
      state: (await all("settings")).find(
        (row) =>
          row.id === "cloud-sync" && row.workspaceId === connection.workspaceId,
      ),
      snapshot: await readSnapshot(),
    };
  });
  const digest = fingerprint(snapshot);
  const previous = state?.revision ?? null;
  const remote = await relay(connection, "read");
  if (remote.revision === digest) {
    await tx(() => remember(connection, digest));
    return "Google Drive is up to date.";
  }
  if (remote.revision !== previous) {
    if (digest !== previous || !remote.revision)
      throw new Error(
        "Local and Google Drive records have diverged. Both versions are preserved.",
      );
    const latest = await relay(connection, "download");
    const updated = await decodeSnapshot(latest, connection);
    await tx(async () => {
      await checkWorkspace(connection);
      if (fingerprint(await readSnapshot()) !== digest)
        throw new Error(
          "New local changes arrived during sync. Both versions are preserved.",
        );
      await replaceSnapshot(updated);
      await remember(connection, latest.revision!);
    });
    return "Downloaded changes from Google Drive.";
  }
  const encrypted = await seal(
    snapshot,
    connection.passphrase,
    randomBytes(16),
    randomBytes(12),
  );
  await relay(connection, "append", digest, encrypted, previous ?? undefined);
  await tx(() => remember(connection, digest));
  return "Synced to Google Drive.";
}

async function checkWorkspace(connection: CloudConnection) {
  const credentials = (await all("settings")).find(
    (row) => row.id === "cloud-credentials",
  );
  if (credentials?.workspaceId !== connection.workspaceId)
    throw new Error("The local workspace changed during sync.");
}

async function remember(connection: CloudConnection, revision: string) {
  await checkWorkspace(connection);
  return put("settings", {
    id: "cloud-sync",
    workspaceId: connection.workspaceId,
    revision,
  });
}
