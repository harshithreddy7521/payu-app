"use client";

import { apiFetch } from "./api";
import type { LoginResponse, UserSummary } from "@fee/shared";

const TOKEN_KEY = "fee_token";
const USER_KEY = "fee_user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getUser(): UserSummary | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(sessionStorage.getItem(USER_KEY) ?? "null"); } catch { return null; }
}

export async function login(email: string, password: string): Promise<UserSummary> {
  const res = await apiFetch<LoginResponse>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  sessionStorage.setItem(TOKEN_KEY, res.token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(res.user));
  return res.user;
}

export function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}
