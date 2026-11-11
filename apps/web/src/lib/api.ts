const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function apiFetch<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const { token, ...rest } = init ?? {};
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...rest.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw Object.assign(new Error(err.message ?? "API error"), { status: res.status, code: err.code });
  }
  return res.json() as T;
}
