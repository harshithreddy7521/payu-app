const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<T> {
  const { token, ...rest } = init ?? {};
  if (
    typeof window !== "undefined" &&
    (!rest.method || rest.method === "GET") &&
    /^\/v1\/(dashboard|transactions|groups|reminders)(?:\?|$)/.test(path)
  ) {
    const branch = sessionStorage.getItem("fee_branch");
    if (branch)
      path += `${path.includes("?") ? "&" : "?"}branchId=${encodeURIComponent(branch)}`;
  }
  const headers = new Headers(rest.headers);
  // Bodyless requests must not advertise JSON: Fastify rejects an empty JSON body.
  // Leave multipart boundaries and explicitly supplied content types to the caller.
  if (
    typeof rest.body === "string" &&
    rest.body.length > 0 &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization"))
    headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API}${path}`, { ...rest, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw Object.assign(new Error(err.message ?? "API error"), {
      status: res.status,
      code: err.code,
    });
  }
  return res.json() as T;
}
