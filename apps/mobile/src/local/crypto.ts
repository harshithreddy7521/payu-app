import { scryptAsync } from "@noble/hashes/scrypt";
import { gcm } from "@noble/ciphers/aes";
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  bytesToUtf8,
} from "@noble/ciphers/utils";
export const KDF = { N: 32768, r: 8, p: 1, dkLen: 32 };
const AAD = utf8ToBytes("Feeflow encrypted backup v1");
export async function passwordKey(password: string, salt: string) {
  return scryptAsync(utf8ToBytes(password), hexToBytes(salt), KDF);
}
export const hex = bytesToHex;
export async function seal(
  data: unknown,
  password: string,
  salt: Uint8Array,
  nonce: Uint8Array,
) {
  if (password.length < 12)
    throw new Error("Use a backup passphrase of at least 12 characters.");
  const key = await passwordKey(password, hex(salt));
  try {
    return JSON.stringify({
      format: "feeflow-backup",
      version: 1,
      kdf: "scrypt-32768-8-1",
      salt: hex(salt),
      nonce: hex(nonce),
      ciphertext: hex(
        gcm(key, nonce, AAD).encrypt(utf8ToBytes(JSON.stringify(data))),
      ),
    });
  } finally {
    key.fill(0);
  }
}
export async function unseal(text: string, password: string): Promise<unknown> {
  if (text.length > 40_000_000)
    throw new Error("Backup exceeds the 20 MB database limit.");
  const e = JSON.parse(text);
  if (
    e?.format !== "feeflow-backup" ||
    e.version !== 1 ||
    e.kdf !== "scrypt-32768-8-1" ||
    !/^([0-9a-f]{32})$/.test(e.salt) ||
    !/^([0-9a-f]{24})$/.test(e.nonce) ||
    typeof e.ciphertext !== "string" ||
    !/^([0-9a-f]{2})+$/.test(e.ciphertext) ||
    e.ciphertext.length > 40_000_000
  )
    throw new Error("Unsupported or damaged backup.");
  const key = await passwordKey(password, e.salt);
  try {
    return JSON.parse(
      bytesToUtf8(
        gcm(key, hexToBytes(e.nonce), AAD).decrypt(hexToBytes(e.ciphertext)),
      ),
    );
  } catch {
    throw new Error("Wrong passphrase or damaged backup.");
  } finally {
    key.fill(0);
  }
}
export function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
