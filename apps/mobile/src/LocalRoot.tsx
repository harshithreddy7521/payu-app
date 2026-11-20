import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  Text,
  ActivityIndicator,
} from "react-native";
import App from "./App";
import { init, all } from "./local/store";
import { cloudEndpoint, registerSchool } from "./local/cloud";
import {
  workspaceTypes,
  type WorkspaceType,
  type SchoolProfile,
} from "./local/onboarding";
import { Card, Button, Field, Heading, styles, colors } from "./components/ui";

export default function LocalRoot() {
  const [ready, setReady] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [exists, setExists] = useState(false);
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [profile, setProfile] = useState<SchoolProfile>({
    industry: "SCHOOL",
    name: "",
    address: "",
    phone: "",
    vpa: "",
    storage: "local",
  });
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [credentials, setCredentials] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [restoreId, setRestoreId] = useState("");
  const update = (field: keyof SchoolProfile, value: string) =>
    setProfile((previous) => ({ ...previous, [field]: value }));

  useEffect(() => {
    void init()
      .then(() => Promise.all([all("users"), all("settings")]))
      .then(([users, settings]) => {
        setWorkspaceName(
          settings.find((row) => row.id === "business")?.name ?? "",
        );
        setExists(users.length > 0);
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await registerSchool(name, email.trim(), password, profile, {
        spreadsheetId,
        credentials,
        passphrase,
        restoreId,
      });
      setPassword("");
      setConfirm("");
      setCredentials("");
      setPassphrase("");
      setWorkspaceName(
        (await all("settings")).find((row) => row.id === "business")?.name ??
          "",
      );
      setExists(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready)
    return (
      <SafeAreaView style={styles.page}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator />
        )}
      </SafeAreaView>
    );

  if (exists || !signup)
    return (
      <App
        workspaceName={workspaceName}
        onSignup={exists ? undefined : () => setSignup(true)}
      />
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.page}
      >
        <Heading
          title={
            restoreId.trim()
              ? "Restore a cloud workspace"
              : "Create a workspace"
          }
        />
        <Card>
          {!restoreId.trim() && (
            <>
              <Text style={styles.label}>Workspace type</Text>
              {(Object.keys(workspaceTypes) as WorkspaceType[]).map(
                (industry) => (
                  <Button
                    key={industry}
                    title={workspaceTypes[industry]}
                    secondary={profile.industry !== industry}
                    onPress={() => setProfile({ ...profile, industry })}
                  />
                ),
              )}
              <Field
                label={workspaceTypes[profile.industry ?? "SCHOOL"] + " name"}
                value={profile.name}
                onChangeText={(v) => update("name", v)}
              />
              <Field
                label="Address"
                value={profile.address}
                onChangeText={(v) => update("address", v)}
              />
              <Field
                label="Contact number"
                keyboardType="phone-pad"
                value={profile.phone}
                onChangeText={(v) => update("phone", v)}
              />
              <Field
                label="Administrator name"
                value={name}
                onChangeText={setName}
              />
            </>
          )}
          <Field
            label="Administrator email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Field
            label="Password (10+ characters)"
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

          <Text style={styles.label}>Storage</Text>
          <Button
            title="On this device"
            secondary={profile.storage !== "local"}
            onPress={() => {
              update("storage", "local");
              setRestoreId("");
            }}
          />
          <Button
            title="Google Drive"
            disabled={!cloudEndpoint()}
            secondary={profile.storage !== "cloud"}
            onPress={() => update("storage", "cloud")}
          />
          {!cloudEndpoint() && (
            <Text style={styles.sub}>
              Google Drive is unavailable in this build.
            </Text>
          )}
          {profile.storage === "cloud" && (
            <>
              <Text style={styles.sub}>
                Create a Google spreadsheet with a tab named Feeflow and share
                it with the service account as an editor.
              </Text>
              <Field
                label="Google spreadsheet ID"
                autoCapitalize="none"
                value={spreadsheetId}
                onChangeText={setSpreadsheetId}
              />
              <Field
                label="Google service-account JSON key"
                autoCapitalize="none"
                secureTextEntry
                value={credentials}
                onChangeText={setCredentials}
              />
              <Field
                label="Existing cloud workspace ID (optional)"
                autoCapitalize="none"
                value={restoreId}
                onChangeText={setRestoreId}
              />
              <Field
                label="Cloud backup passphrase (12+ characters)"
                secureTextEntry
                value={passphrase}
                onChangeText={setPassphrase}
              />
            </>
          )}

          {!restoreId.trim() && (
            <>
              <Text style={styles.label}>Payment method</Text>
              <Text style={styles.sub}>Direct UPI is selected.</Text>
              <Button
                title="Razorpay (coming later)"
                secondary
                disabled
                onPress={() => {}}
              />
              <Field
                label="UPI address"
                autoCapitalize="none"
                value={profile.vpa}
                onChangeText={(v) => update("vpa", v)}
              />
            </>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Button
            title={restoreId.trim() ? "Restore workspace" : "Create account"}
            busy={busy}
            disabled={
              (!name && !restoreId.trim()) ||
              !email ||
              password.length < 10 ||
              password !== confirm
            }
            onPress={() => void submit()}
          />
          <Button
            title="Back to sign in"
            secondary
            disabled={busy}
            onPress={() => {
              setPassword("");
              setConfirm("");
              setCredentials("");
              setPassphrase("");
              setError("");
              setSignup(false);
            }}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
