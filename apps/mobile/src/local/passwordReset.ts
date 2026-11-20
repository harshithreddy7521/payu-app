import { lock, passwordFields } from "./api";
import { cloudEndpoint } from "./cloud";
import { hex, seal, unseal } from "./crypto";
import { all, put, randomBytes, tx } from "./repository";

async function relay(body: object) {
  const endpoint = cloudEndpoint();
  if (!endpoint)
    throw new Error("Email reset requires a configured Feeflow web address.");
  const response = await fetch(new URL("/api/password-reset", endpoint).href, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.message || "Email reset unavailable.");
  return payload as { email: string; challenge: string; expires: number };
}

export async function requestPasswordReset(email: string) {
  const user = (await all("users")).find(
    (row) => row.active && row.email === email.trim().toLowerCase(),
  );
  if (!user) return;
  const challenge = hex(randomBytes(32));
  const resetId = "password-reset:" + user.id;
  await tx(async () => {
    const prior = (await all("settings")).find((row) => row.id === resetId);
    if (prior && prior.requestedAt > Date.now() - 60_000)
      throw new Error("Wait one minute before requesting another link.");
    await put("settings", {
      id: resetId,
      challenge,
      requestedAt: Date.now(),
      passwordHash: user.hash,
    });
  });
  await relay({ action: "request", email: user.email, challenge });
}

export async function resetPassword(
  link: string,
  password: string,
  recoveryPassphrase: string,
) {
  const token = link.trim().split("#").at(-1);
  const proof = await relay({ action: "verify", token });
  await tx(async () => {
    const user = (await all("users")).find(
      (row) => row.active && row.email === proof.email,
    );
    const settings = await all("settings");
    const pending = settings.find(
      (row) => row.id === "password-reset:" + user?.id,
    );
    if (
      !user ||
      !pending ||
      pending.challenge !== proof.challenge ||
      pending.passwordHash !== user.hash ||
      proof.expires <= Date.now()
    )
      throw new Error("Request a fresh link on this phone or in this browser.");
    const keys = await passwordFields(password);
    const credentials = settings.find((row) => row.id === "cloud-credentials");
    if (user.role === "OWNER" && credentials) {
      if (!credentials.recoveryEnvelope)
        throw new Error(
          "Sign in once with the current owner password to enable cloud password recovery.",
        );
      if (!recoveryPassphrase)
        throw new Error(
          "Enter the workspace’s Google Drive backup passphrase.",
        );
      const connection = await unseal(
        credentials.recoveryEnvelope,
        recoveryPassphrase,
      );
      await put("settings", {
        ...credentials,
        envelope: await seal(
          connection,
          password,
          randomBytes(16),
          randomBytes(12),
          10,
        ),
      });
    }
    await put("users", { ...user, ...keys });
    await put("settings", { id: pending.id, requestedAt: 0 });
  });
  lock();
}
