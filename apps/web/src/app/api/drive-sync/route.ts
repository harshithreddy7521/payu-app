import { createSign } from "node:crypto";
import { z } from "zod";

const inputSchema = z.object({
  spreadsheetId: z.string().regex(/^[\w-]{20,150}$/),
  workspaceId: z.string().uuid(),
  clientEmail: z.string().email().endsWith(".gserviceaccount.com"),
  privateKey: z.string().min(100).max(5000),
  action: z.enum(["read", "download", "append", "connect"]),
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  parent: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  snapshot: z.string().max(1_800_000).optional(),
});
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const base64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

async function token(email: string, key: string) {
  const now = Math.floor(Date.now() / 1000);
  const claim =
    base64({ alg: "RS256", typ: "JWT" }) +
    "." +
    base64({
      iss: email,
      aud: tokenEndpoint,
      iat: now,
      exp: now + 300,
      scope:
        "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly",
    });
  const assertion =
    claim + "." + createSign("RSA-SHA256").update(claim).sign(key, "base64url");
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Credentials rejected");
  return (await response.json()).access_token as string;
}

export async function POST(request: Request) {
  const failure = (message: string, status: number) =>
    Response.json({ message }, { status });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return failure("Send JSON to connect Google Drive.", 415);
  try {
    const reader = request.body?.getReader();
    if (!reader) return failure("Missing Google Drive data.", 400);
    const decoder = new TextDecoder();
    let text = "",
      size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_850_000) {
        await reader.cancel();
        return failure(
          "The cloud snapshot exceeds the synchronization limit.",
          413,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed = inputSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return failure(
        "Check the spreadsheet ID, service-account key or snapshot size.",
        400,
      );
    const {
      spreadsheetId,
      clientEmail,
      privateKey,
      workspaceId,
      action,
      revision,
      snapshot,
      parent,
    } = parsed.data;
    const accessToken = await token(clientEmail, privateKey);
    const sheet = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const endpoint = sheet + "/values/";
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
    if (action === "connect") {
      const drive = await fetch(
        `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=capabilities(canEdit)`,
        {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!drive.ok || !(await drive.json()).capabilities?.canEdit)
        return failure(
          "Enable the Google Drive API and share the spreadsheet with the service account as an editor.",
          502,
        );
      const metadata = await fetch(
        sheet +
          "?fields=sheets(properties(sheetId,title,gridProperties(columnCount)))",
        {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!metadata.ok)
        return failure(
          "Share the spreadsheet with the service account as an editor.",
          502,
        );
      const { sheets } = (await metadata.json()) as {
        sheets?: {
          properties: {
            sheetId: number;
            title: string;
            gridProperties?: { columnCount: number };
          };
        }[];
      };
      const tab = sheets?.find(
        ({ properties }) => properties.title === "Feeflow",
      )?.properties;
      if (!tab?.gridProperties)
        return failure(
          "Create a spreadsheet tab named Feeflow and try again.",
          400,
        );
      const length = 43 - tab.gridProperties.columnCount;
      const requests =
        length > 0
          ? [
              {
                appendDimension: {
                  sheetId: tab.sheetId,
                  dimension: "COLUMNS",
                  length,
                },
              },
            ]
          : [];
      if (requests.length) {
        const configured = await fetch(sheet + ":batchUpdate", {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({ requests }),
        });
        if (!configured.ok)
          return failure(
            "Give the service account editor access to the spreadsheet.",
            502,
          );
      }
      return Response.json({ revision: null });
    }
    const response = await fetch(endpoint + "Feeflow!A:C", {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      return failure(
        "Share the spreadsheet with the service account as an editor and create a tab named Feeflow.",
        502,
      );
    const { values = [] } = (await response.json()) as { values?: string[][] };
    const revisions = new Map<string, { parent: string; row: number }>();
    values.forEach(([workspace, version, base], index) => {
      if (workspace === workspaceId && /^[a-f0-9]{64}$/.test(version))
        revisions.set(version, { parent: base || "", row: index + 1 });
    });
    const used = new Set(
      Array.from(revisions.values(), (entry) => entry.parent),
    );
    const heads = Array.from(revisions.keys()).filter(
      (version) => !used.has(version),
    );
    if (revisions.size && heads.length !== 1)
      return failure(
        "This cloud workspace has competing revisions. Both versions are preserved.",
        409,
      );
    const latest = heads[0] ?? null;

    if (action === "append") {
      if (!revision || !snapshot)
        return failure("Missing snapshot or revision.", 400);
      if (latest === revision) return Response.json({ revision });
      if ((parent ?? null) !== latest)
        return failure("Google Drive changed during sync. Try again.", 409);
      const chunks = snapshot.match(/[\s\S]{1,45000}/g) ?? [];
      const saved = await fetch(
        endpoint +
          "Feeflow!A:AQ:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
        {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            values: [[workspaceId, revision, parent ?? "", ...chunks]],
          }),
        },
      );
      if (!saved.ok)
        return failure(
          "Google Sheets could not save the snapshot. Check editor access and free sheet capacity.",
          502,
        );
      return Response.json({ revision });
    }
    if (action === "download" && latest) {
      const { row } = revisions.get(latest)!;
      const downloaded = await fetch(endpoint + `Feeflow!A${row}:AQ${row}`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!downloaded.ok)
        return failure("Google Sheets could not read the snapshot.", 502);
      const data = (await downloaded.json()).values?.[0] as
        | string[]
        | undefined;
      if (data?.[0] !== workspaceId || data[1] !== latest)
        return failure(
          "The spreadsheet changed during download. Try again.",
          409,
        );
      return Response.json({
        revision: latest,
        snapshot: data.slice(3).join(""),
      });
    }
    return Response.json({ revision: latest });
  } catch {
    return failure(
      "Google Drive could not be reached. Check the service-account key and try again.",
      502,
    );
  }
}
