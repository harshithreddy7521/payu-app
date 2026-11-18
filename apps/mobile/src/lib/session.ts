import type { UserSummary } from "@fee/shared";
import { lock } from "../local/api";
export type Session = { token: string; user: UserSummary };
// No persistent bearer token: every process start requires a fresh local unlock.
export async function loadSession(): Promise<Session | null> {
  return null;
}
export async function saveSession(_session: Session) {}
export async function clearSession() {
  lock();
}
