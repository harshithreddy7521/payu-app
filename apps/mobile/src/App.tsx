import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  Switch,
  Text,
  View,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import QRCode from "react-native-qrcode-svg";
import type { DashboardStats, UserSummary } from "@fee/shared";
import { rupeesToPaise } from "./lib/validation";
import { systemPickerActive } from "./local/lockState";
import BackupPanel from "./local/BackupPanel";
import { runBilling } from "./local/api";
import { apiFetch, ApiError } from "./local/api";
import { clearSession, loadSession, saveSession, Session } from "./lib/session";
import {
  Button,
  Card,
  Field,
  Heading,
  styles,
  colors,
  money,
} from "./components/ui";
type Branch = { id: string; name: string };
type Member = {
  id: string;
  name: string;
  externalRef?: string;
  guardians: {
    id: string;
    name: string;
    phone: string;
    whatsappConsentedAt?: string;
    optOut: boolean;
  }[];
};
type Group = {
  id: string;
  name: string;
  amountPaise: number;
  isActive: boolean;
  nextBillDates?: string[];
  memberships?: {
    id: string;
    memberId: string;
    leftAt: string | null;
    member: { name: string };
  }[];
};
type Bill = {
  id: string;
  purpose: string;
  amountPaise: number;
  paidPaise: number;
  status: string;
  payments: {
    receiptNo: string;
    amountPaise: number;
    source: string;
    referenceMasked: string;
  }[];
};
const tabs = [
  "Quick Pay",
  "Overview",
  "Members",
  "Groups",
  "Transactions",

  "Settings",
];
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [boot, setBoot] = useState(true),
    [bootError, setBootError] = useState(""),
    [tab, setTab] = useState("Quick Pay"),
    [branches, setBranches] = useState<Branch[]>([]),
    [branch, setBranch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [amount, setAmount] = useState(""),
    [purpose, setPurpose] = useState(""),
    [pay, setPay] = useState<{
      billId: string;
      checkoutUrl: string;
      upiIntentUrl?: string;
    } | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [groups, setGroups] = useState<Group[]>([]),
    [bills, setBills] = useState<Bill[]>([]),
    [finance, setFinance] = useState<{
      refunds: any[];
      settlements: any[];
      destinations: any[];
    }>({ refunds: [], settlements: [], destinations: [] });
  const [selected, setSelected] = useState<Group | null>(null),
    [memberName, setMemberName] = useState(""),
    [memberRef, setMemberRef] = useState(""),
    [guardian, setGuardian] = useState(""),
    [phone, setPhone] = useState(""),
    [groupName, setGroupName] = useState(""),
    [fee, setFee] = useState(""),
    [day, setDay] = useState("1"),
    [verifyBill, setVerifyBill] = useState<Bill | null>(null),
    [reference, setReference] = useState(""),
    [verified, setVerified] = useState(false),
    [received, setReceived] = useState(""),
    [note, setNote] = useState(""),
    [refundReason, setRefundReason] = useState(""),
    [bankMask, setBankMask] = useState(""),
    [ifsc, setIfsc] = useState("");
  const requestKey = useRef<{ body: string; key: string } | null>(null);
  const seq = useRef(0);
  const auth = useRef(session);
  auth.current = session;
  const financeRole = !!session?.user.roles.some((r) =>
    ["OWNER", "FINANCE"].includes(r),
  );
  const manageRole = !!session?.user.roles.some((r) =>
    ["OWNER", "BRANCH_MANAGER"].includes(r),
  );
  async function logout() {
    seq.current++;
    await clearSession();
    setSession(null);
    setPassword("");
    setPay(null);
    setSelected(null);
    setVerifyBill(null);
    setMembers([]);
    setGroups([]);
    setBills([]);
    setStats(null);
    setFinance({ refunds: [], settlements: [], destinations: [] });
    setAmount("");
    setPayAmount("");
    setPurpose("");
    setReference("");
    setMemberName("");
    setMemberRef("");
    setGuardian("");
    setPhone("");
    setNote("");
    setError("");
    setNotice("");
    requestKey.current = null;
  }
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    try {
      return await apiFetch<T>(path, {
        method,
        token: auth.current?.token,
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(key ? { headers: { "Idempotency-Key": key } } : {}),
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await logout();
        setError("Your session expired. Please sign in again.");
      }
      throw e;
    }
  }
  function keyFor(body: unknown) {
    const fingerprint = JSON.stringify(body);
    if (requestKey.current?.body !== fingerprint)
      requestKey.current = {
        body: fingerprint,
        key: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    return requestKey.current.key;
  }
  async function restore() {
    setBootError("");
    setBoot(true);
    try {
      await runBilling();
      const saved = await loadSession();
      if (saved) {
        await apiFetch("/v1/auth/me", { token: saved.token });
        setSession(saved);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await clearSession();
      else setBootError((e as Error).message);
    } finally {
      setBoot(false);
    }
  }
  useEffect(() => {
    void restore();
  }, []);
  useEffect(() => {
    let backgrounded=false;
    const sub = AppState.addEventListener("change", (state) => {
      if(state==="background")backgrounded=true;
      if(state==="active" && backgrounded && auth.current && !systemPickerActive()){backgrounded=false;void logout();return;}
      if (state === "background" && auth.current && !systemPickerActive()) {
        void logout();
        return;
      }
      if (state === "active" && auth.current)
        void apiFetch("/v1/auth/me", { token: auth.current.token }).catch(
          (e) => {
            if (e instanceof ApiError && e.status === 401) void logout();
          },
        );
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selected || verifyBill) {
        setSelected(null);
        setVerifyBill(null);
        return true;
      }
      if (tab !== "Quick Pay") {
        setTab("Quick Pay");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [tab, selected, verifyBill]);
  async function act(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      requestKey.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    await runBilling();
    if (!auth.current) return;
    const id = ++seq.current;
    setRefreshing(true);
    setError("");
    try {
      const suffix = branch ? `?branchId=${encodeURIComponent(branch)}` : "";
      if (tab === "Quick Pay" || tab === "Settings") {
        const r = await request<{ data: Branch[] }>("/v1/branches");
        if (id === seq.current) {
          setBranches(r.data);
          if (!branch && r.data.length === 1) setBranch(r.data[0].id);
        }
      }
      if (tab === "Overview") {
        const data = await request<DashboardStats>("/v1/dashboard" + suffix);
        if (id === seq.current) setStats(data);
      }
      if (tab === "Members") {
        const r = await request<{ data: Member[] }>("/v1/members");
        if (id === seq.current) setMembers(r.data);
      }
      if (tab === "Groups") {
        const r = await request<{ data: Group[] }>("/v1/groups" + suffix);
        if (id === seq.current) setGroups(r.data);
        const m = await request<{ data: Member[] }>("/v1/members");
        if (id === seq.current) setMembers(m.data);
      }
      if (tab === "Transactions") {
        const r = await request<{ data: Bill[] }>("/v1/transactions" + suffix);
        if (id === seq.current) setBills(r.data);
      }
      if (tab === "Finance" && financeRole) {
        const [r, s, d] = await Promise.all([
          request<{ data: any[] }>("/v1/refunds"),
          request<{ data: any[] }>("/v1/settlements"),
          request<{ data: any[] }>("/v1/destinations"),
        ]);
        if (id === seq.current)
          setFinance({
            refunds: r.data,
            settlements: s.data,
            destinations: d.data,
          });
      }
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setRefreshing(false);
    }
  }
  useEffect(() => {
    setSelected(null);
    setVerifyBill(null);
    setError("");
    setNotice("");
    void refresh();
  }, [tab, branch, session?.token]);
  async function openGroup(id: string) {
    setSelected(await request<Group>(`/v1/groups/${id}`));
  }
  async function openUpi() {
    if (!pay?.upiIntentUrl?.startsWith("upi://pay?"))
      throw new Error(
        "UPI intent unavailable. Share the checkout link instead.",
      );
    try {
      await Linking.openURL(pay.upiIntentUrl);
    } catch {
      throw new Error(
        "No supported UPI app could be opened. Share the payment link or scan the QR.",
      );
    }
  }
  if (boot)
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator accessibilityLabel="Restoring session" />
      </SafeAreaView>
    );
  if (bootError)
    return (
      <SafeAreaView style={styles.page}>
        <Heading title="Reconnect to your workspace" />
        <Text style={styles.error}>{bootError}</Text>
        <Button title="Retry connection" onPress={() => void restore()} />
        <Button
          title="Sign in with another account"
          secondary
          onPress={() => {
            setBootError("");
            void logout();
          }}
        />
      </SafeAreaView>
    );
  if (!session)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={[
              styles.page,
              { flexGrow: 1, justifyContent: "center" },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <Text
              style={{ fontSize: 32, color: colors.green, fontWeight: "700" }}
            >
              feeflow ✦
            </Text>
            <Heading
              title="Less chasing. More growing."
              sub="Your community, collections and billing in one place."
            />
            <Card>
              <Field
                label="Work email"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
              <Field
                label="Password"
                secureTextEntry
                autoComplete="password"
                value={password}
                onChangeText={setPassword}
              />
              {!!error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              )}
              <Button
                title="Sign in"
                busy={busy}
                disabled={!email || !password}
                onPress={() =>
                  void act(async () => {
                    const result = await apiFetch<Session>("/v1/auth/login", {
                      method: "POST",
                      body: JSON.stringify({ email: email.trim(), password }),
                    });
                    await saveSession(result);
                    setSession(result);
                    setPassword("");
                    setTab("Quick Pay");
                  })
                }
              />
            </Card>
            <Text style={styles.sub}>
              Single-device storage. All records stay on this phone. Payments are verified by authorised staff.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: colors.green }}>
          feeflow ✦
        </Text>
        <Text style={styles.sub}>
          {session.user.orgName} · {session.user.name}
        </Text>
      </View>
      <ScrollView
        horizontal
        style={{ flexGrow: 0, maxHeight: 58 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {tabs
          .filter((t) => t !== "Finance" || financeRole)
          .map((t) => (
            <Button
              key={t}
              title={t}
              secondary={tab !== t}
              onPress={() => setTab(t)}
            />
          ))}
      </ScrollView>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.page}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
            />
          }
        >
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          {!!notice && (
            <Text accessibilityRole="alert" style={styles.success}>
              {notice}
            </Text>
          )}
          {tab === "Quick Pay" && (
            <>
              <Heading
                title="Keep things flowing."
                sub="Create a request, share a UPI request, or show a UPI QR."
              />
              <Card>
                {branches.map((b) => (
                  <Button
                    key={b.id}
                    title={b.name + (branch === b.id ? " ✓" : "")}
                    secondary={branch !== b.id}
                    onPress={() => setBranch(b.id)}
                  />
                ))}
                {!branches.length && (
                  <Text style={styles.sub}>
                    No available branch. Pull to refresh or contact your owner.
                  </Text>
                )}
                {!pay ? (
                  <>
                    <Field
                      label="Amount (₹)"
                      keyboardType="decimal-pad"
                      value={payAmount}
                      onChangeText={setPayAmount}
                    />
                    <Field
                      label="Purpose"
                      value={purpose}
                      onChangeText={setPurpose}
                    />
                    <Button
                      title="Create payment request"
                      busy={busy}
                      disabled={
                        !branch ||
                        !purpose.trim() ||
                        !/^\d+(\.\d{1,2})?$/.test(payAmount) ||
                        Number(payAmount) <= 0
                      }
                      onPress={() =>
                        void act(async () => {
                          const body = {
                            branchId: branch,
                            amountPaise: rupeesToPaise(payAmount),
                            purpose: purpose.trim(),
                            isGuest: true,
                          };
                          const result = await request<{
                            billId: string;
                            checkoutUrl: string;
                            paymentLinkToken: string;
                          }>("/v1/quick-pay", "POST", body, keyFor(body));
                          setPay(result);
                          try {
                            const order = await request<{
                              upiIntentUrl?: string;
                            }>(
                              `/pay/${result.paymentLinkToken}/checkout`,
                              "POST",
                              {},
                            );
                            setPay({ ...result, ...order });
                          } catch (e) {
                            setError(
                              "Request created and preserved. " +
                                (e as Error).message,
                            );
                          }
                        })
                      }
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.title}>
                      {money(rupeesToPaise(payAmount))}
                    </Text>
                    <Text style={styles.sub}>{purpose}</Text>
                    <View
                      accessible
                      accessibilityLabel="UPI payment QR"
                      style={{ alignItems: "center", padding: 15 }}
                    >
                      <QRCode
                        value={pay.upiIntentUrl ?? pay.checkoutUrl}
                        size={220}
                      />
                    </View>
                    <Text selectable style={styles.sub}>
                      {pay.checkoutUrl}
                    </Text>
                    <Button
                      title="Share UPI payment request"
                      onPress={() =>
                        void act(async () => {
                          await Share.share({ message: pay.checkoutUrl });
                        })
                      }
                    />
                    <Button
                      title="Open UPI app"
                      secondary
                      onPress={() => void act(openUpi)}
                    />
                    <Text style={styles.sub}>
                      Real money may be transferred. A scan or app return does
                      not confirm payment.
                    </Text>
                    <Button
                      title="New request"
                      secondary
                      onPress={() => {
                        setPay(null);
                        setPayAmount("");
                        setPurpose("");
                        requestKey.current = null;
                      }}
                    />
                  </>
                )}
              </Card>
            </>
          )}
          {tab === "Overview" && (
            <>
              <Heading
                title="A little clarity."
                sub="Collections reflect payment confirmation; outstanding balances reflect bill creation."
              />
              {stats &&
                Object.entries({
                  Collected: stats.grossConfirmedPaise,
                  Outstanding: stats.outstandingPaise,
                  Refunded: stats.refundedPaise,
                  "Provider available": stats.availablePaise,
                  Held: stats.heldPaise,
                  Settled: stats.settledPaise,
                }).map(([name, value]) => (
                  <Card key={name}>
                    <Text style={styles.sub}>{name}</Text>
                    <Text style={styles.title}>{money(value)}</Text>
                  </Card>
                ))}
            </>
          )}
          {tab === "Members" && (
            <>
              <Heading
                title="Your community."
                sub="Showing the latest 50 active members. Pull to refresh."
              />
              {manageRole && (
                <Card>
                  <Field
                    label="Member name"
                    value={memberName}
                    onChangeText={setMemberName}
                  />
                  <Field
                    label="Member reference"
                    value={memberRef}
                    onChangeText={setMemberRef}
                  />
                  <Field
                    label="Guardian name"
                    value={guardian}
                    onChangeText={setGuardian}
                  />
                  <Field
                    label="Guardian phone (optional)"
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={setPhone}
                  />
                  <Button
                    title="Add member"
                    busy={busy}
                    disabled={
                      !memberName.trim() || (!!phone && !guardian.trim())
                    }
                    onPress={() =>
                      void act(async () => {
                        await request("/v1/members", "POST", {
                          name: memberName,
                          externalRef: memberRef || undefined,
                          guardians: phone ? [{ name: guardian, phone }] : [],
                        });
                        setMemberName("");
                        setMemberRef("");
                        setPhone("");
                        setGuardian("");
                        await refresh();
                      })
                    }
                  />
                </Card>
              )}
              {members.map((m) => (
                <Card key={m.id}>
                  <Text style={styles.label}>{m.name}</Text>
                  <Text style={styles.sub}>
                    {m.externalRef ?? "No reference"} ·{" "}
                    {m.guardians[0]?.phone.replace(/.(?=.{4})/g, "•") ??
                      "No contact"}
                  </Text>
                  {manageRole && (
                    <Button
                      title="Archive member"
                      secondary
                      onPress={() =>
                        Alert.alert(
                          "Archive member?",
                          "History and existing bills will be retained.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Archive",
                              onPress: () =>
                                void act(async () => {
                                  await request(
                                    `/v1/members/${m.id}/archive`,
                                    "PATCH",
                                  );
                                  await refresh();
                                }),
                            },
                          ],
                        )
                      }
                    />
                  )}
                </Card>
              ))}
              {!members.length && !refreshing && (
                <Text style={styles.sub}>No members yet.</Text>
              )}
            </>
          )}
          {tab === "Groups" && (
            <>
              <Heading
                title="Groups & billing."
                sub="Monthly fees follow Asia/Kolkata scheduling."
              />
              {!selected ? (
                <>
                  {manageRole && (
                    <Card>
                      <Field
                        label="Group name"
                        value={groupName}
                        onChangeText={setGroupName}
                      />
                      <Field
                        label="Monthly fee (₹)"
                        keyboardType="decimal-pad"
                        value={fee}
                        onChangeText={setFee}
                      />
                      <Field
                        label="Issue day (1–31, blank for month-end)"
                        keyboardType="number-pad"
                        value={day}
                        onChangeText={setDay}
                      />
                      <Button
                        title="Preview and create group"
                        disabled={!branch || !groupName || Number(fee) <= 0}
                        busy={busy}
                        onPress={() =>
                          void act(async () => {
                            const body = {
                              branchId: branch,
                              name: groupName,
                              amountPaise: rupeesToPaise(fee),
                              billDayOfMonth: day ? Number(day) : null,
                              dueDayOffset: 7,
                            };
                            const preview = await request<{
                              cycles: { issueDate: string; dueDate: string }[];
                            }>("/v1/groups/preview", "POST", body);
                            Alert.alert(
                              "Confirm billing schedule",
                              preview.cycles
                                .map((c) => `${c.issueDate} → due ${c.dueDate}`)
                                .join("\n"),
                              [
                                { text: "Cancel" },
                                {
                                  text: "Create",
                                  onPress: () =>
                                    void act(async () => {
                                      await request("/v1/groups", "POST", body);
                                      setGroupName("");
                                      setFee("");
                                      await refresh();
                                    }),
                                },
                              ],
                            );
                          })
                        }
                      />
                    </Card>
                  )}
                  {groups.map((g) => (
                    <Card key={g.id}>
                      <Text style={styles.label}>
                        {g.name} · {g.isActive ? "Active" : "Paused"}
                      </Text>
                      <Text style={styles.title}>{money(g.amountPaise)}</Text>
                      <Button
                        title="Manage group"
                        secondary
                        onPress={() => void act(() => openGroup(g.id))}
                      />
                    </Card>
                  ))}
                </>
              ) : (
                <Card>
                  <Heading title={selected.name} />
                  <Text style={styles.sub}>
                    Next cycles:{" "}
                    {selected.nextBillDates?.join(" · ") || "No future cycles"}
                  </Text>
                  {manageRole && (
                    <Button
                      title={
                        selected.isActive
                          ? "Pause future billing"
                          : "Resume billing"
                      }
                      secondary
                      onPress={() =>
                        void act(async () => {
                          await request(`/v1/groups/${selected.id}`, "PATCH", {
                            isActive: !selected.isActive,
                          });
                          await openGroup(selected.id);
                        })
                      }
                    />
                  )}
                  <Text style={styles.label}>Active memberships</Text>
                  {selected.memberships
                    ?.filter((m) => !m.leftAt)
                    .map((m) => (
                      <View key={m.id} style={{ gap: 8 }}>
                        <Text>{m.member.name}</Text>
                        {manageRole && (
                          <Button
                            title={`Remove ${m.member.name}`}
                            secondary
                            onPress={() =>
                              Alert.alert(
                                "Remove from group?",
                                "Existing bills remain payable.",
                                [
                                  { text: "Cancel" },
                                  {
                                    text: "Remove",
                                    onPress: () =>
                                      void act(async () => {
                                        await request(
                                          `/v1/groups/${selected.id}/members/${m.memberId}`,
                                          "DELETE",
                                        );
                                        await openGroup(selected.id);
                                      }),
                                  },
                                ],
                              )
                            }
                          />
                        )}
                      </View>
                    ))}
                  {manageRole &&
                    members
                      .filter(
                        (m) =>
                          !selected.memberships?.some(
                            (x) => x.memberId === m.id && !x.leftAt,
                          ),
                      )
                      .map((m) => (
                        <Button
                          key={m.id}
                          title={`Add ${m.name} from next cycle`}
                          secondary
                          busy={busy}
                          onPress={() =>
                            void act(async () => {
                              const body = { memberId: m.id };
                              await request(
                                `/v1/groups/${selected.id}/members`,
                                "POST",
                                body,
                                keyFor({ group: selected.id, ...body }),
                              );
                              await openGroup(selected.id);
                            })
                          }
                        />
                      ))}
                  <Button
                    title="Back to groups"
                    secondary
                    onPress={() => setSelected(null)}
                  />
                </Card>
              )}
            </>
          )}
          {tab === "Transactions" && (
            <>
              <Heading
                title="Follow the flow."
                sub="Latest 50 bills. Staff verification records a bank credit; it never transfers money."
              />
              {verifyBill && (
                <Card>
                  <Heading
                    title="Record verified payment"
                    sub={verifyBill.purpose}
                  />
                  <Field
                    label="Amount received (₹)"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                  />
                  <Field
                    label="Bank / UPI reference"
                    value={reference}
                    onChangeText={setReference}
                    autoCapitalize="characters"
                  />
                  <Field
                    label="Received at (ISO date with timezone)"
                    value={received}
                    onChangeText={setReceived}
                  />
                  <Field
                    label="Verification note"
                    value={note}
                    onChangeText={setNote}
                  />
                  <Text style={styles.sub}>
                    I checked the receiving UPI app and confirmed this credit.
                  </Text>
                  <Switch
                    accessibilityLabel="I verified the receiving account"
                    value={verified}
                    onValueChange={setVerified}
                  />
                  <Button
                    title="Confirm verified payment"
                    busy={busy}
                    disabled={!verified || !reference || !amount}
                    onPress={() =>
                      void act(async () => {
                        const data = await request<{ receiptNo: string }>(
                          `/v1/transactions/${verifyBill.id}/verified-payment`,
                          "POST",
                          {
                            amountPaise: rupeesToPaise(amount),
                            reference,
                            receivedAt: received,
                            verificationMethod: "UPI_APP",
                            note,
                            verified,
                          },
                        );
                        setNotice("Recorded. Receipt " + data.receiptNo);
                        setVerifyBill(null);
                        await refresh();
                      })
                    }
                  />
                  <Button
                    title="Cancel verification"
                    secondary
                    onPress={() => setVerifyBill(null)}
                  />
                </Card>
              )}
              {bills.map((b) => (
                <Card key={b.id}>
                  <Text style={styles.label}>{b.purpose}</Text>
                  <Text style={styles.title}>
                    {money(b.amountPaise - b.paidPaise)}
                  </Text>
                  <Text style={styles.sub}>
                    {b.status} · Paid {money(b.paidPaise)}
                  </Text>
                  {b.payments.map((p) => (
                    <Text selectable key={p.receiptNo} style={styles.sub}>
                      {p.source === "MANUAL_UPI"
                        ? "Staff verified"
                        : "Provider confirmed"}{" "}
                      · {money(p.amountPaise)} · {p.referenceMasked}
                      {"\n"}Receipt {p.receiptNo}
                    </Text>
                  ))}
                  {financeRole &&
                    ["ISSUED", "PARTIAL", "EXPIRED"].includes(b.status) &&
                    b.paidPaise < b.amountPaise && (
                      <Button
                        title="Record verified payment"
                        secondary
                        onPress={() => {
                          setVerifyBill(b);
                          setAmount(
                            ((b.amountPaise - b.paidPaise) / 100).toFixed(2),
                          );
                          setReference("");
                          setReceived(new Date().toISOString());
                          setVerified(false);
                          setNote("");
                        }}
                      />
                    )}
                </Card>
              ))}
              {!bills.length && !refreshing && (
                <Text style={styles.sub}>No bills found.</Text>
              )}
            </>
          )}
          {tab === "Settings" && (
            <>
              <Heading title="Your workspace." />
              {session.user.roles.includes("OWNER" as never) && (
                <BackupPanel
                  token={session.token}
                  onRestore={() => void logout()}
                />
              )}
              <Card>
                <Text style={styles.label}>{session.user.name}</Text>
                <Text style={styles.sub}>
                  {session.user.email}
                  {"\n"}
                  {session.user.roles.join(" · ")}
                </Text>
                <Text style={styles.sub}>Active branch</Text>
                <Button
                  title="All permitted branches"
                  secondary
                  onPress={() => setBranch("")}
                />
                {branches.map((b) => (
                  <Button
                    key={b.id}
                    title={b.name + (branch === b.id ? " ✓" : "")}
                    secondary
                    onPress={() => setBranch(b.id)}
                  />
                ))}
                <Text style={styles.sub}>
                  Single-device mode. Support: harshithhari.bh@gmail.com. No cloud connection.
                </Text>
                <Button
                  title="Sign out and clear this device"
                  secondary
                  onPress={() => void act(logout)}
                />
              </Card>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export default App;
