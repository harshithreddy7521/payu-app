import { exportEncrypted, restoreEncrypted } from "./backupService";
import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as Picker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { admin, checkPassword, lock, createUser } from "./api";
import { tx, put, id } from "./store";
import { allowSystemPicker, endSystemPicker } from "./lockState";
import { seal, unseal } from "./crypto";
import { Button, Card, Field, styles } from "../components/ui";
export default function BackupPanel({
  token,
  onRestore,
}: {
  token: string;
  onRestore: () => void;
}) {
  const [administrator, setAdministrator] = useState(false);
  const [password, setPassword] = useState(""),
    [passphrase, setPassphrase] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [staffPassword, setStaffPassword] = useState("");
  async function authorised() {
    const user = await admin(token);
    if (!(await checkPassword(user, password)))
      throw new Error("Administrator password is incorrect.");
    return user;
  }
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportFile() {
    const user = await authorised();
    if (passphrase !== confirm)
      throw new Error("Backup passphrases do not match.");
    const text = await exportEncrypted(token, password, passphrase);
    const file = new File(Paths.cache, `Feeflow-${Date.now()}.feeflow`);
    try {
      file.write(text);
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("Android sharing is not available.");
      allowSystemPicker();
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/octet-stream",
        dialogTitle: "Save your encrypted Feeflow backup",
      });
      await tx(() =>
        put("audit", {
          id: id(),
          action: "BACKUP_EXPORTED",
          userId: user.id,
          at: new Date().toISOString(),
        }),
      );
      setMessage(
        "Backup prepared. Confirm it was saved in your chosen destination. Keep its passphrase separately.",
      );
    } finally {
      endSystemPicker();
      if (file.exists) file.delete();
      setPassphrase("");
      setConfirm("");
      setPassword("");
    }
  }
  async function importFile() {
    await authorised();
    allowSystemPicker();
    const picked = await Picker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picked.canceled) {
      endSystemPicker();
      return;
    }
    const file = new File(picked.assets[0].uri);
    try {
      if (file.size > 40_000_000) throw new Error("Backup file is too large.");
      await restoreEncrypted(token, password, passphrase, await file.text());
      lock();
      setPassphrase("");
      setConfirm("");
      setPassword("");
      onRestore();
    } finally {
      endSystemPicker();
      if (file.exists) file.delete();
    }
  }
  return (
    <Card>
      <Text style={styles.title}>Admin controls</Text>
      <Text style={styles.sub}>
        Back up all local tables in one encrypted file. Import replaces every
        local record, including accounts. After restore, unlock with an
        administrator account from that backup. No cloud upload is performed.
      </Text>
      <Field
        label="Current administrator password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Field
        label="Backup passphrase (12+ characters)"
        secureTextEntry
        value={passphrase}
        onChangeText={setPassphrase}
      />
      <Field
        label="Confirm backup passphrase (export only)"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
      />
      <Button
        title="Export all tables"
        busy={busy}
        disabled={!password || passphrase.length < 12 || passphrase !== confirm}
        onPress={() => void action(exportFile)}
      />
      <Button
        title="Import backup and replace device data"
        secondary
        busy={busy}
        disabled={!password || passphrase.length < 12}
        onPress={() =>
          Alert.alert(
            "Replace all Feeflow data?",
            "Export a current backup first. This replaces all tables, users and settings. The file must pass validation before any changes are made.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Replace data",
                style: "destructive",
                onPress: () => void action(importFile),
              },
            ],
          )
        }
      />
      {!!message && (
        <Text accessibilityRole="alert" style={styles.sub}>
          {message}
        </Text>
      )}
      <Text style={styles.label}>Add staff account</Text>
      <Text style={styles.sub}>
        Staff can add members, create payment requests and send reminders.
        Owners manage concessions, groups, verified payments and backups.
      </Text>
      <Field label="Staff name" value={name} onChangeText={setName} />
      <Field
        label="Staff email"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <Field
        label="Staff password (10+ characters)"
        secureTextEntry
        value={staffPassword}
        onChangeText={setStaffPassword}
      />
      <Button
        title={
          administrator ? "Access level: Administrator" : "Access level: Staff"
        }
        secondary
        onPress={() => setAdministrator(!administrator)}
      />
      <Button
        title="Create staff account"
        busy={busy}
        disabled={!password || !name || !email || staffPassword.length < 10}
        onPress={() =>
          void action(async () => {
            await authorised();
            await tx(() =>
              createUser(
                email,
                name,
                staffPassword,
                administrator ? "BRANCH_MANAGER" : "COLLECTOR",
              ),
            );
            setEmail("");
            setName("");
            setStaffPassword("");
            setMessage("Collector created. Sign out to switch accounts.");
          })
        }
      />
      <Text style={styles.sub}>
        Support: harshithhari.bh@gmail.com. Uninstalling the app or losing this
        phone loses local data unless you retain an exported backup. The export
        passphrase cannot be recovered.
      </Text>
    </Card>
  );
}
