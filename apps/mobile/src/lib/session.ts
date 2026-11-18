import * as SecureStore from "expo-secure-store";
import type { UserSummary } from "@fee/shared";
export type Session = { token: string; user: UserSummary };
const KEY = "feeflow.session.v1";
export async function loadSession(): Promise<Session | null> {
  try {
    const value = await SecureStore.getItemAsync(KEY);
    if (!value) return null;
    const s = JSON.parse(value);
    if (typeof s.token !== "string" || !s.user?.id) return null;
    return s;
  } catch {
    return null;
  }
}
export async function saveSession(session: Session) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
export async function clearSession() {
  await SecureStore.deleteItemAsync(KEY);
}
