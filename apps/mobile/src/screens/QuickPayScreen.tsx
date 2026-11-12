import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { apiFetch } from "../lib/api";
import type { QuickPayResponse } from "@fee/shared";

interface Props {
  token: string;
  orgId: string;
  branchId: string;
}

export function QuickPayScreen({ token, orgId, branchId }: Props) {
  const requestRef = useRef<{ body: string; key: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuickPayResponse | null>(null);
  const [upiUrl, setUpiUrl] = useState<string | null>(null);

  async function create() {
    const paise = Math.round(parseFloat(amount) * 100);
    if (!paise || paise <= 0) {
      Alert.alert("Enter a valid amount");
      return;
    }
    setLoading(true);
    try {
      const fingerprint = JSON.stringify({ amount, branchId, purpose });
      if (requestRef.current?.body !== fingerprint)
        requestRef.current = {
          body: fingerprint,
          key: `mobile-${Date.now()}-${Math.random()}`,
        };
      const res = await apiFetch<QuickPayResponse>("/v1/quick-pay", {
        method: "POST",
        token,
        headers: { "Idempotency-Key": requestRef.current!.key },
        body: JSON.stringify({
          amountPaise: paise,
          branchId,
          purpose,
          isGuest: true,
        }),
      });
      setResult(res);
      // Start checkout to get UPI intent URL
      const checkout = await apiFetch<{ upiIntentUrl?: string }>(
        `/pay/${res.paymentLinkToken}/checkout`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (checkout.upiIntentUrl) setUpiUrl(checkout.upiIntentUrl);
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  if (result)
    return (
      <ScrollView contentContainerStyle={s.container}>
        <Text style={s.title}>Payment request created</Text>
        <Text style={s.amount}>
          ₹{parseFloat(amount).toLocaleString("en-IN")}
        </Text>
        <Text style={s.sub}>{purpose}</Text>
        <View style={s.qrWrap}>
          <QRCode value={upiUrl ?? result.checkoutUrl} size={200} />
        </View>
        <Text style={s.hint}>Scan QR or tap button to pay</Text>
        {upiUrl && (
          <TouchableOpacity
            style={s.btn}
            onPress={() => Linking.openURL(upiUrl)}
          >
            <Text style={s.btnText}>Open UPI app</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.btn, { backgroundColor: "#e2e8f0", marginTop: 10 }]}
          onPress={() => {
            requestRef.current = null;
            setResult(null);
            setAmount("");
            setPurpose("");
          }}
        >
          <Text style={[s.btnText, { color: "#0f172a" }]}>New request</Text>
        </TouchableOpacity>
      </ScrollView>
    );

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Text style={s.title}>Quick Pay</Text>
      <Text style={s.label}>Amount (₹)</Text>
      <TextInput
        style={s.amountInput}
        keyboardType="numeric"
        value={amount}
        onChangeText={setAmount}
        placeholder="0"
      />
      <Text style={s.label}>Purpose</Text>
      <TextInput
        style={s.input}
        value={purpose}
        onChangeText={setPurpose}
        placeholder="e.g. Tuition fee — June"
      />
      <TouchableOpacity style={s.btn} onPress={create} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={s.btnText}>Create payment request</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#f8fafc" },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 20,
    color: "#0f172a",
  },
  label: { fontSize: 13, fontWeight: "600", color: "#64748b", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 15,
    backgroundColor: "#fff",
  },
  amountInput: {
    borderBottomWidth: 2,
    borderColor: "#e2e8f0",
    fontSize: 32,
    fontWeight: "700",
    paddingVertical: 8,
    marginBottom: 20,
    color: "#0f172a",
  },
  btn: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  amount: {
    fontSize: 32,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },
  sub: { color: "#64748b", marginBottom: 24 },
  qrWrap: { alignItems: "center", marginVertical: 20 },
  hint: {
    textAlign: "center",
    color: "#64748b",
    fontSize: 13,
    marginBottom: 16,
  },
});
