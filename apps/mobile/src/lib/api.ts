import { releaseApiOrigin } from "./validation";
import { Platform } from "react-native";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function apiOrigin() {
  const url =
    process.env.EXPO_PUBLIC_API_URL ??
    (__DEV__
      ? `http://${Platform.OS === "android" ? "10.0.2.2" : "localhost"}:3001`
      : "");
  if (!url) throw new Error("The release API URL is not configured.");
  return releaseApiOrigin(url, __DEV__);
}
export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<T> {
  const { token, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${apiOrigin()}${path}`, {
      ...rest,
      headers,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok)
      throw new ApiError(
        data?.message ?? `Request failed (${res.status})`,
        res.status,
      );
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new Error(
      "Cannot connect. Check your connection and retry. Your form has been preserved.",
    );
  } finally {
    clearTimeout(timer);
  }
}
