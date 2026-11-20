import React, { useState } from "react";
import { Text } from "react-native";
import { Button, Field, styles } from "../components/ui";
import { requestPasswordReset, resetPassword } from "./passwordReset";

export default function PasswordResetPanel({
  email,
  close,
}: {
  email: string;
  close: () => void;
}) {
  const [address, setAddress] = useState(email);
  const [link, setLink] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      await task();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Field
        label="Account email"
        keyboardType="email-address"
        autoCapitalize="none"
        value={address}
        onChangeText={setAddress}
      />
      <Button
        title="Email reset link"
        busy={busy}
        disabled={!address.trim()}
        onPress={() =>
          void run(async () => {
            await requestPasswordReset(address);
            setStatus(
              "If the account is on this device, a reset link has been sent.",
            );
          })
        }
      />
      <Field
        label="Paste the reset link from your email"
        autoCapitalize="none"
        value={link}
        onChangeText={setLink}
      />
      <Field
        label="New password (10+ characters)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Field
        label="Confirm password"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
      />
      <Field
        label="Backup passphrase (Google Drive owners only)"
        secureTextEntry
        value={recovery}
        onChangeText={setRecovery}
      />
      <Button
        title="Set new password"
        busy={busy}
        disabled={!link.trim() || password.length < 10 || password !== confirm}
        onPress={() =>
          void run(async () => {
            await resetPassword(link, password, recovery);
            close();
          })
        }
      />
      {status && (
        <Text accessibilityRole="alert" style={styles.sub}>
          {status}
        </Text>
      )}
      <Button title="Back to sign in" secondary onPress={close} />
    </>
  );
}
