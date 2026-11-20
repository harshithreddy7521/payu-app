import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const proof = z.object({
  email: z.string().email().max(254),
  challenge: z.string().regex(/^[a-f0-9]{64}$/),
});
const verifyPayload = proof.extend({ expires: z.number() });
const recent = new Map<string, number>();

export async function POST(request: Request) {
  const secret = process.env.FEEFLOW_RESET_SECRET;
  const from = process.env.FEEFLOW_RESET_FROM;
  const apiKey = process.env.RESEND_API_KEY;
  const origin = process.env.FEEFLOW_PUBLIC_URL;
  const error = (message: string, status: number) =>
    Response.json({ message }, { status });
  if (!secret || secret.length < 32 || !origin || !from || !apiKey)
    return error(
      "Password reset email is unavailable for this deployment.",
      503,
    );
  const sign = (text: string) =>
    createHmac("sha256", secret).update(text).digest("base64url");
  try {
    const body = await request.json();
    if (body.action === "verify") {
      const [payload, signature, extra] =
        typeof body.token === "string" && body.token.length <= 1024
          ? body.token.split(".")
          : [];
      if (!payload || !signature || extra !== undefined)
        return error("Invalid reset link.", 400);
      const expected = Buffer.from(sign(payload));
      const actual = Buffer.from(signature);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return error("Invalid reset link.", 400);
      const verified = verifyPayload.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString()),
      );
      if (verified.expires <= Date.now())
        return error("The reset link expired.", 400);
      return Response.json(verified);
    }
    if (body.action !== "request") return error("Invalid reset request.", 400);
    const { email, challenge } = proof.parse(body);
    const now = Date.now();
    for (const [key, time] of recent) if (time <= now) recent.delete(key);
    const recipient = email.trim().toLowerCase();
    if (recent.has(recipient) || recent.size >= 1000)
      return error("Wait before requesting another reset link.", 429);
    recent.set(recipient, now + 60_000);
    const payload = Buffer.from(
      JSON.stringify({
        email: recipient,
        challenge,
        expires: now + 20 * 60_000,
      }),
    ).toString("base64url");
    const link = new URL("/reset-password", origin);
    if (link.protocol !== "https:")
      return error("Configure an HTTPS reset origin.", 503);
    link.hash = payload + "." + sign(payload);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: "Reset your workspace password",
        text: `Open this link to reset your password in the browser that requested it. On Android, copy the link into the app’s reset screen. This link expires in 20 minutes.\n\n${link.href}\n\nIf you did not request this, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return error("The reset email could not be sent.", 502);
    return Response.json({ ok: true });
  } catch {
    return error("The reset request could not be processed.", 400);
  }
}
