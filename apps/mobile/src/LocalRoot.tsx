import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  Text,
  ActivityIndicator,
} from "react-native";
import App from "./App";
import { init, all } from "./local/store";
import { setup } from "./local/api";
import { Card, Button, Field, Heading, styles, colors } from "./components/ui";
export default function LocalRoot() {
  const [ready, setReady] = useState(false),
    [exists, setExists] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [business, setBusiness] = useState("");
  async function boot() {
    try {
      await init();
      setExists((await all("users")).length > 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void boot();
  }, []);
  if (!ready)
    return (
      <SafeAreaView>
        <ActivityIndicator />
      </SafeAreaView>
    );
  if (exists) return <App />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.page}
      >
        <Heading
          title="Feeflow · your device"
          sub="Create this device’s administrator. All business records stay on this phone."
        />
        <Card>
          <Field
            label="Business name"
            value={business}
            onChangeText={setBusiness}
          />
          <Field
            label="Administrator name"
            value={name}
            onChangeText={setName}
          />
          <Field
            label="Administrator email"
            autoCapitalize="none"
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
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Button
            title="Create local administrator"
            busy={busy}
            disabled={
              !name || !email || password.length < 10 || password !== confirm
            }
            onPress={() => {
              setBusy(true);
              setError("");
              void setup(name, email, password, business)
                .then(() => {
                  setPassword("");
                  setConfirm("");
                  setExists(true);
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          />
          <Text style={styles.sub}>
            Moving from another device? Create a temporary administrator, sign
            in, then use Settings → Import backup. The imported administrator
            account replaces this temporary account.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
