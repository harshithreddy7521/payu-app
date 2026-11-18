import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInputProps,
} from "react-native";
export const colors = {
  bg: "#f5f6ef",
  ink: "#203d31",
  muted: "#617668",
  green: "#17694d",
  border: "#dce5d7",
};
export const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 45, gap: 16 },
  card: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 20,
    gap: 12,
  },
  title: { fontSize: 29, fontWeight: "700", color: colors.ink },
  sub: { color: colors.muted, lineHeight: 22 },
  label: { color: colors.ink, fontWeight: "600", marginBottom: 6 },
  input: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    minHeight: 48,
    color: colors.ink,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 10,
    padding: 14,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "white", fontWeight: "600", fontSize: 15 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  error: {
    padding: 15,
    backgroundColor: "#fff0ec",
    borderRadius: 10,
    color: "#9e352e",
  },
  success: {
    padding: 15,
    backgroundColor: "#e7f0e2",
    color: colors.green,
    borderRadius: 10,
  },
});
export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}
export function Button({
  title,
  onPress,
  busy,
  disabled,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.button,
        secondary && { backgroundColor: "#e8efe1" },
        (disabled || busy) && { opacity: 0.5 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color="white" />
      ) : (
        <Text style={[styles.buttonText, secondary && { color: colors.green }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#8c9988"
        style={styles.input}
        {...props}
      />
    </View>
  );
}
export function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <View>
      <Text style={styles.title}>{title}</Text>
      {sub && <Text style={styles.sub}>{sub}</Text>}
    </View>
  );
}
export const money = (n: number) =>
  `₹${(n / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
