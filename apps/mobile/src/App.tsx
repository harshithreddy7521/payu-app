import {
  payable,
  remaining,
  type BalanceBill,
  type MemberTotals,
} from "./local/memberBalance";
import {
  parseFeeCharges,
  paymentPlans,
  type PaymentPlan,
  type FeePlan,
} from "./local/feePlans";
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
import PasswordResetPanel from "./local/PasswordResetPanel";
import { cloudEndpoint } from "./local/cloud";
import BackupPanel from "./local/BackupPanel";
import { upiUrl, validVpa, type SchoolProfile } from "./local/onboarding";
import { syncCloud, unlockCloud } from "./local/cloud";
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
  totals?: MemberTotals;
  feePaise?: number;
  hostelFeePaise?: number;
  concessionPercent?: number;
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
  feePlan?: FeePlan;
  reminderPolicies?: {
    offsetDays: number;
    sendTimeIST: string;
    language: string;
    isActive: boolean;
  }[];
  memberships?: {
    id: string;
    memberId: string;
    leftAt: string | null;
    member: { name: string };
    paidThrough?: string;
    accessStatus?: string;
  }[];
};
type Reminder = {
  id: string;
  status: string;
  scheduledAt: string;
  failureReason: string | null;
  bill: {
    id: string;
    memberId?: string;
    purpose: string;
    amountPaise: number;
    paidPaise: number;
  };
};
type Bill = {
  id: string;
  purpose: string;
  amountPaise: number;
  paidPaise: number;
  plannedTotalPaise?: number;
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
  "Reminders",

  "Settings",
];
function App({
  onSignup,
  workspaceName,
}: {
  onSignup?: () => void;
  workspaceName?: string;
}) {
  const [profile, setProfile] = useState<SchoolProfile>();
  const [vpa, setVpa] = useState("");
  const [cloud, setCloud] = useState<Awaited<ReturnType<typeof unlockCloud>>>();
  const [syncStatus, setSyncStatus] = useState("");
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
  const [recover, setRecover] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payPhone, setPayPhone] = useState("");
  const [memberCsv, setMemberCsv] = useState("");
  const [csvRows, setCsvRows] = useState<
    { row: number; name: string; errors: string[] }[]
  >([]);
  const [classId, setClassId] = useState("");
  const [plan, setPlan] = useState<PaymentPlan>("MONTHLY");
  const [withHostel, setWithHostel] = useState(false);
  const [optionalCharges, setOptionalCharges] = useState<string[]>([]);
  const [academicMonth, setAcademicMonth] = useState("");
  const [classHostel, setClassHostel] = useState("");
  const [extraCharges, setExtraCharges] = useState("");
  const [sportsMode, setSportsMode] = useState<
    "SPORTS_RENEWAL" | "SPORTS_FIXED"
  >("SPORTS_RENEWAL");
  const [termMonths, setTermMonths] = useState(1);
  const [overrideFee, setOverrideFee] = useState("");

  const [standardFee, setStandardFee] = useState("");
  const [tuition, setTuition] = useState("");
  const [hostel, setHostel] = useState("");
  const [feeMember, setFeeMember] = useState("");
  const [concession, setConcession] = useState("");
  const [payConsent, setPayConsent] = useState(false);
  const [reminderRows, setReminderRows] = useState<Reminder[]>([]);
  const [consentGuardian, setConsentGuardian] = useState("");
  const [consentEvidence, setConsentEvidence] = useState("");
  const [reminderOffsets, setReminderOffsets] = useState("-3, 0, 3");
  const [reminderTime, setReminderTime] = useState("10:00");
  const [reminderHindi, setReminderHindi] = useState(false);
  const [reminderLimits, setReminderLimits] = useState({
    reminderStartHour: 8,
    reminderEndHour: 20,
    reminderDailyCap: 3,
  });
  const [amount, setAmount] = useState(""),
    [purpose, setPurpose] = useState(""),
    [pay, setPay] = useState<{
      billId: string;
      checkoutUrl: string;
      upiIntentUrl?: string;
      whatsappUrl?: string;
    } | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [quickQuery, setQuickQuery] = useState("");
  const [pickingMember, setPickingMember] = useState(false);
  const [quickMember, setQuickMember] = useState<Member>();
  const [quickBills, setQuickBills] = useState<BalanceBill[]>([]);
  const [quickBillId, setQuickBillId] = useState("");
  const [paymentMember, setPaymentMember] = useState<{
    id: string;
    name: string;
  }>();
  const [memberPayments, setMemberPayments] = useState<{
    totals: MemberTotals;
    bills: BalanceBill[];
  }>();
  const [stats, setStats] = useState<DashboardStats | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [groups, setGroups] = useState<Group[]>([]),
    [bills, setBills] = useState<Bill[]>([]);
  const [selected, setSelected] = useState<Group | null>(null),
    [memberName, setMemberName] = useState(""),
    [memberRef, setMemberRef] = useState(""),
    [guardian, setGuardian] = useState(""),
    [phone, setPhone] = useState(""),
    [groupName, setGroupName] = useState(""),
    [fee, setFee] = useState(""),
    [verifyBill, setVerifyBill] = useState<BalanceBill | null>(null),
    [reference, setReference] = useState(""),
    [verified, setVerified] = useState(false),
    [received, setReceived] = useState(""),
    [note, setNote] = useState(""),
    [refundReason, setRefundReason] = useState(""),
    [bankMask, setBankMask] = useState(""),
    [ifsc, setIfsc] = useState("");
  const pageScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const requestKey = useRef<{ body: string; key: string } | null>(null);
  const seq = useRef(0);
  const auth = useRef(session);
  auth.current = session;
  const restaurant = session?.user.profile === "RESTAURANT";
  const school = session?.user.profile === "SCHOOL";
  const enrollment = { paymentPlan: plan, hostel: withHostel, optionalCharges };
  const enrollmentPlan = (
    tab === "Groups" ? selected : groups.find((group) => group.id === classId)
  )?.feePlan;
  function resetEnrollment() {
    setPlan("MONTHLY");
    setWithHostel(false);
    setOptionalCharges([]);
  }
  const enrollmentFields = enrollmentPlan && (
    <>
      {enrollmentPlan.mode !== "SPORTS_RENEWAL" && (
        <>
          <Text style={styles.label}>Payment plan</Text>
          {(Object.keys(paymentPlans) as PaymentPlan[]).map((option) => (
            <Button
              key={option}
              title={paymentPlans[option]}
              secondary={plan !== option}
              onPress={() => setPlan(option)}
            />
          ))}
        </>
      )}
      {enrollmentPlan.mode === "SCHOOL" && enrollmentPlan.hostelPaise > 0 && (
        <View style={styles.row}>
          <Switch
            value={withHostel}
            onValueChange={setWithHostel}
            accessibilityLabel="Include hostel"
          />
          <Text style={styles.sub}>
            Hostel {money(enrollmentPlan.hostelPaise)}
          </Text>
        </View>
      )}
      {enrollmentPlan.charges
        .filter((charge) => charge.optional)
        .map((charge) => (
          <View key={charge.name} style={styles.row}>
            <Switch
              value={optionalCharges.includes(charge.name)}
              accessibilityLabel={charge.name}
              onValueChange={(selected) =>
                setOptionalCharges(
                  selected
                    ? [...optionalCharges, charge.name]
                    : optionalCharges.filter((name) => name !== charge.name),
                )
              }
            />
            <Text style={styles.sub}>
              {charge.name} · {money(charge.amountPaise)}
              {charge.upfront ? " · upfront" : ""}
            </Text>
          </View>
        ))}
    </>
  );
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
    setCloud(undefined);
    setSyncStatus("");
    setProfile(undefined);
    setVpa("");
    setPassword("");
    setPay(null);
    setSelected(null);
    setVerifyBill(null);
    setMembers([]);
    setGroups([]);
    setBills([]);
    setStats(null);
    setAmount("");
    setPayAmount("");
    setPayPhone("");
    setQuickMember(undefined);
    setQuickBills([]);
    setQuickBillId("");
    setQuickQuery("");
    setPickingMember(false);
    setPaymentMember(undefined);
    setMemberPayments(undefined);
    setMemberQuery("");
    setPayConsent(false);
    setMemberCsv("");
    setCsvRows([]);
    setOverrideFee("");
    setClassId("");
    resetEnrollment();
    setReminderRows([]);
    setConsentGuardian("");
    setConsentEvidence("");
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
    if (!cloud) return;
    let active = true;
    const sync = () => {
      void syncCloud(cloud).then(
        async (status) => {
          const current = auth.current;
          if (!active || !current) return;
          setSyncStatus(status);
          try {
            const latest = await apiFetch<SchoolProfile>("/v1/local/profile", {
              token: current.token,
            });
            if (active) setProfile(latest);
          } catch (e) {
            if (active) setSyncStatus((e as Error).message);
          }
        },
        (error: Error) => {
          if (active) setSyncStatus(error.message);
        },
      );
    };
    sync();
    const timer = setInterval(sync, 3_600_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [cloud]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      void runBilling().catch((e: Error) => setError(e.message));
    }, 3_600_000);
    return () => clearInterval(timer);
  }, [session]);
  useEffect(() => {
    void restore();
  }, []);
  useEffect(() => {
    let backgrounded = false;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") backgrounded = true;
      if (
        state === "active" &&
        backgrounded &&
        auth.current &&
        !systemPickerActive()
      ) {
        backgrounded = false;
        void logout();
        return;
      }
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
    if (!auth.current) return;
    const id = ++seq.current;
    setRefreshing(true);
    setError("");
    try {
      await runBilling();
      const suffix = branch ? `?branchId=${encodeURIComponent(branch)}` : "";
      if (tab === "Quick Pay" || tab === "Settings") {
        const r = await request<{ data: Branch[] }>("/v1/branches");
        if (id === seq.current) {
          setBranches(r.data);
          if (!branch && r.data.length === 1) setBranch(r.data[0].id);
        }
      }
      if (tab === "Settings" && manageRole && !restaurant) {
        const limits = await request<typeof reminderLimits>(
          "/v1/reminder-settings",
        );
        if (id === seq.current) setReminderLimits(limits);
      }
      if (tab === "Quick Pay" && !restaurant) {
        const data = await request<{ data: Member[] }>("/v1/members");
        if (id === seq.current) setMembers(data.data);
      }
      if (tab === "Overview") {
        const data = await request<DashboardStats>("/v1/dashboard" + suffix);
        if (id === seq.current) setStats(data);
      }
      if (tab === "Members") {
        const available = await request<{ data: Group[] }>("/v1/groups");
        if (id === seq.current) setGroups(available.data);
        const r = await request<{ data: Member[] }>("/v1/members");
        if (id === seq.current) setMembers(r.data);
      }
      if (tab === "Groups") {
        const r = await request<{ data: Group[] }>("/v1/groups" + suffix);
        if (id === seq.current) setGroups(r.data);
        const m = await request<{ data: Member[] }>("/v1/members");
        if (id === seq.current) setMembers(m.data);
      }
      if (tab === "Reminders") {
        const result = await request<{ data: Reminder[] }>("/v1/reminders");
        if (id === seq.current) setReminderRows(result.data);
      }
      if (tab === "Transactions") {
        const r = await request<{ data: Bill[] }>("/v1/transactions" + suffix);
        if (id === seq.current) setBills(r.data);
      }
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setRefreshing(false);
    }
  }
  function chooseQuickBill(bill?: BalanceBill) {
    setQuickBillId(bill?.id ?? "");
    setPurpose(bill?.purpose ?? "");
    setPayAmount(
      bill
        ? (
            (bill.amountPaise - bill.paidPaise || remaining(bill)) / 100
          ).toFixed(2)
        : "",
    );
  }
  function memberBalance(id: string) {
    return request<{
      name?: string;
      totals: MemberTotals;
      bills: BalanceBill[];
    }>(`/v1/members/${id}/balance`);
  }
  async function chooseQuickMember(member: Member) {
    const data = await memberBalance(member.id);
    const open = data.bills.filter(
      (bill) => payable(bill) && remaining(bill) > 0,
    );
    setQuickMember(member);
    setQuickBills(open);
    setPickingMember(false);
    if (open.some((bill) => bill.amountPaise > bill.paidPaise))
      chooseQuickBill(open.find((bill) => bill.amountPaise > bill.paidPaise));
  }
  function chooseVerification(bill: BalanceBill, requestedAmount?: number) {
    setVerifyBill(bill);
    const prefill =
      requestedAmount && requestedAmount <= remaining(bill)
        ? requestedAmount
        : bill.amountPaise - bill.paidPaise || remaining(bill);
    setAmount((prefill / 100).toFixed(2));
    pageScroll.current?.scrollTo({ y: 0, animated: true });
    setReference("");
    setReceived(new Date().toISOString());
    setVerified(false);
    setNote("");
  }
  async function openMemberPayments(
    id: string,
    name: string,
    billId?: string,
    requestedAmount?: number,
  ) {
    const data = await memberBalance(id);
    setTab("Members");
    setVerifyBill(null);
    setPaymentMember({ id, name: data.name ?? name });
    pageScroll.current?.scrollTo({ y: 0, animated: true });
    setMemberPayments(data);
    if (billId) {
      const bill = data.bills.find((row) => row.id === billId);
      if (bill && financeRole && payable(bill) && remaining(bill) > 0)
        chooseVerification(bill, requestedAmount);
    }
  }
  const matchesMember = (member: Member, value: string) =>
    [
      member.name,
      member.externalRef,
      ...member.guardians.map((guardian) => guardian.phone),
    ].some((field) =>
      field?.toLowerCase().includes(value.trim().toLowerCase()),
    );
  useEffect(() => {
    setSelected(null);
    if (tab !== "Members") setVerifyBill(null);
    setError("");
    setNotice("");
    void refresh();
  }, [tab, branch, session?.token]);
  async function openGroup(id: string) {
    const group = await request<Group>(`/v1/groups/${id}`);
    setSelected(group);
    resetEnrollment();
    const policies = group.reminderPolicies?.filter((p) => p.isActive) ?? [];
    setReminderOffsets(policies.map((p) => p.offsetDays).join(", "));
    setReminderTime(policies[0]?.sendTimeIST ?? "10:00");
    setReminderHindi(policies[0]?.language === "hi");
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
              {workspaceName || "Feeflow"}
            </Text>
            <Heading
              title="Less chasing. More growing."
              sub="Your community, collections and billing in one place."
            />
            <Card>
              {recover ? (
                <PasswordResetPanel
                  email={email}
                  close={() => {
                    setRecover(false);
                    setPassword("");
                  }}
                />
              ) : (
                <>
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
                        const result = await apiFetch<Session>(
                          "/v1/auth/login",
                          {
                            method: "POST",
                            body: JSON.stringify({
                              email: email.trim(),
                              password,
                            }),
                          },
                        );
                        const school = await apiFetch<SchoolProfile>(
                          "/v1/local/profile",
                          { token: result.token },
                        );
                        setProfile(school);
                        setStandardFee(
                          school.standardFeePaise
                            ? (school.standardFeePaise / 100).toFixed(2)
                            : "",
                        );
                        setVpa(school.vpa ?? "");
                        try {
                          setCloud(await unlockCloud(result.token, password));
                        } catch {
                          setSyncStatus(
                            "Could not unlock Google Drive credentials.",
                          );
                        }
                        await saveSession(result);
                        setSession(result);
                        setPassword("");
                        setTab("Quick Pay");
                      })
                    }
                  />
                  {!!cloudEndpoint() && (
                    <Button
                      title="Forgot password?"
                      secondary
                      onPress={() => setRecover(true)}
                    />
                  )}
                  {onSignup && (
                    <Button
                      title="Create a workspace"
                      secondary
                      onPress={onSignup}
                    />
                  )}
                </>
              )}
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: colors.green }}>
          {session.user.orgName}
        </Text>
        <Text style={styles.sub}>{session.user.name}</Text>
      </View>
      <ScrollView
        horizontal
        style={{ flexGrow: 0, maxHeight: 58 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {tabs
          .filter(
            (t) =>
              !restaurant ||
              ["Quick Pay", "Transactions", "Settings"].includes(t) ||
              (financeRole && t === "Overview"),
          )
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
          ref={pageScroll}
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
                    setVerifyBill(null);
                    if (tab === "Members" && paymentMember)
                      setMemberPayments(await memberBalance(paymentMember.id));
                    await refresh();
                    setNotice("Recorded. Receipt " + data.receiptNo);
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
                {!pay && profile && validVpa(profile.vpa ?? "") && (
                  <View style={{ alignItems: "center", padding: 15 }}>
                    <Text style={styles.label}>Payment QR</Text>
                    <QRCode
                      value={upiUrl(profile.vpa, profile.name)}
                      size={200}
                    />
                    <Text selectable style={styles.sub}>
                      {profile.vpa}
                    </Text>
                  </View>
                )}
                {!pay && profile && !validVpa(profile.vpa ?? "") && (
                  <Text style={styles.sub}>
                    Set your school UPI address in Settings to collect payments.
                  </Text>
                )}
                {!pay ? (
                  <>
                    {!restaurant && (
                      <>
                        {quickMember ? (
                          <>
                            <Text style={styles.label}>{quickMember.name}</Text>
                            <Button
                              title="Clear member"
                              secondary
                              onPress={() => {
                                setQuickMember(undefined);
                                setQuickBills([]);
                                if (quickBillId) chooseQuickBill();
                              }}
                            />
                          </>
                        ) : (
                          <Button
                            title={
                              pickingMember
                                ? "Close member search"
                                : "Select member (optional)"
                            }
                            secondary
                            onPress={() => setPickingMember(!pickingMember)}
                          />
                        )}
                        {pickingMember && (
                          <>
                            <Field
                              label="Search name, reference or phone"
                              value={quickQuery}
                              onChangeText={setQuickQuery}
                            />
                            {members
                              .filter((member) =>
                                matchesMember(member, quickQuery),
                              )
                              .slice(0, 15)
                              .map((member) => (
                                <Button
                                  key={member.id}
                                  title={
                                    member.externalRef
                                      ? member.name + " · " + member.externalRef
                                      : member.name
                                  }
                                  secondary
                                  busy={busy}
                                  onPress={() =>
                                    void act(() => chooseQuickMember(member))
                                  }
                                />
                              ))}
                            {!members.some((member) =>
                              matchesMember(member, quickQuery),
                            ) && (
                              <Text style={styles.sub}>
                                No matching members.
                              </Text>
                            )}
                          </>
                        )}
                        {quickMember && quickBills.length > 0 && (
                          <>
                            <Text style={styles.label}>Apply payment to</Text>
                            <Button
                              title="Create a new charge"
                              secondary={!!quickBillId}
                              onPress={() => chooseQuickBill()}
                            />
                            {quickBills.map((bill) => (
                              <Button
                                key={bill.id}
                                title={
                                  bill.purpose + " · " + money(remaining(bill))
                                }
                                secondary={quickBillId !== bill.id}
                                onPress={() => chooseQuickBill(bill)}
                              />
                            ))}
                          </>
                        )}
                      </>
                    )}
                    <Field
                      label="Amount (₹)"
                      keyboardType="decimal-pad"
                      value={payAmount}
                      onChangeText={setPayAmount}
                    />
                    <Field
                      label={
                        restaurant
                          ? "Table or order reference (optional)"
                          : "Purpose"
                      }
                      value={purpose}
                      onChangeText={setPurpose}
                    />
                    <Field
                      label="WhatsApp mobile number (optional)"
                      keyboardType="phone-pad"
                      value={payPhone}
                      onChangeText={(value) => {
                        setPayPhone(value);
                        setPayConsent(false);
                      }}
                    />
                    {!!payPhone && (
                      <View style={styles.row}>
                        <Switch
                          value={payConsent}
                          onValueChange={setPayConsent}
                          accessibilityLabel="Recipient agreed to WhatsApp payment messages"
                        />
                        <Text style={styles.sub}>
                          Recipient agreed to WhatsApp payment messages
                        </Text>
                      </View>
                    )}
                    <Button
                      title="Create payment request"
                      busy={busy}
                      disabled={
                        !branch ||
                        !validVpa(profile?.vpa ?? "") ||
                        (!restaurant && !purpose.trim()) ||
                        (!!payPhone.trim() && !payConsent) ||
                        !/^\d+(\.\d{1,2})?$/.test(payAmount) ||
                        Number(payAmount) <= 0
                      }
                      onPress={() =>
                        void act(async () => {
                          const body = {
                            branchId: branch,
                            amountPaise: rupeesToPaise(payAmount),
                            purpose: purpose.trim() || "Counter payment",
                            memberId: quickMember?.id,
                            existingBillId: quickBillId || undefined,
                            isGuest: !quickMember,
                            webOrigin: process.env.EXPO_PUBLIC_WEB_URL,
                            ...(payPhone.trim()
                              ? {
                                  recipientPhone: payPhone.trim(),
                                  deliveryChannel: "WHATSAPP",
                                  deliveryConsent: payConsent,
                                }
                              : {}),
                          };
                          const result = await request<{
                            billId: string;
                            checkoutUrl: string;
                            upiIntentUrl: string;
                            whatsappUrl?: string;
                          }>("/v1/quick-pay", "POST", body, keyFor(body));
                          setPay(result);
                        })
                      }
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.title}>
                      {money(rupeesToPaise(payAmount))}
                    </Text>
                    <Text style={styles.sub}>
                      {purpose}
                      {quickMember ? " · " + quickMember.name : ""}
                    </Text>
                    {quickMember && (
                      <Button
                        title="Member payments"
                        secondary
                        onPress={() =>
                          void act(() =>
                            openMemberPayments(
                              quickMember.id,
                              quickMember.name,
                              pay.billId,
                              rupeesToPaise(payAmount),
                            ),
                          )
                        }
                      />
                    )}
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
                      {pay.upiIntentUrl
                        ? new URL(pay.upiIntentUrl).searchParams.get("pa")
                        : profile?.vpa}
                    </Text>
                    {pay.whatsappUrl && (
                      <Button
                        title="Open WhatsApp to send"
                        onPress={() =>
                          void act(async () => {
                            await Linking.openURL(pay.whatsappUrl!);
                          })
                        }
                      />
                    )}
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
                        setPayPhone("");
                        setPayConsent(false);
                        setQuickMember(undefined);
                        setQuickBills([]);
                        setQuickBillId("");
                        setQuickQuery("");
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
                  ...(!restaurant ? { Refunded: stats.refundedPaise } : {}),
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
              {paymentMember && memberPayments && (
                <Card>
                  <Heading title={paymentMember.name + " · Payments"} />
                  <Text style={styles.label}>
                    Paid {money(memberPayments.totals.paidPaise)}
                  </Text>
                  <Text style={styles.sub}>
                    Due now {money(memberPayments.totals.duePaise)} · Total
                    remaining {money(memberPayments.totals.remainingPaise)}
                  </Text>
                  {memberPayments.bills.map((bill) => (
                    <View key={bill.id} style={{ gap: 6 }}>
                      <Text style={styles.label}>{bill.purpose}</Text>
                      <Text style={styles.sub}>
                        Paid {money(bill.paidPaise)} · Remaining{" "}
                        {money(payable(bill) ? remaining(bill) : 0)}
                      </Text>
                      {financeRole && payable(bill) && remaining(bill) > 0 && (
                        <Button
                          title="Record payment received"
                          secondary
                          onPress={() => chooseVerification(bill)}
                        />
                      )}
                    </View>
                  ))}
                  {!memberPayments.bills.length && (
                    <Text style={styles.sub}>No charges yet.</Text>
                  )}
                  <Button
                    title="Close member payments"
                    secondary
                    onPress={() => {
                      setVerifyBill(null);
                      setPaymentMember(undefined);
                      setMemberPayments(undefined);
                    }}
                  />
                </Card>
              )}
              <Field
                label="Search members"
                value={memberQuery}
                onChangeText={setMemberQuery}
              />

              <Heading
                title="Your community."
                sub="Showing the latest 50 active members. Pull to refresh."
              />
              {session && (
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
                  {groups.some((group) => group.isActive && group.feePlan) && (
                    <>
                      <Text style={styles.label}>
                        {school ? "Class" : "Program"}
                      </Text>
                      <Button
                        title="Enroll later"
                        secondary={!!classId}
                        onPress={() => {
                          setClassId("");
                          resetEnrollment();
                        }}
                      />
                      {groups
                        .filter((group) => group.isActive && group.feePlan)
                        .map((group) => (
                          <Button
                            key={group.id}
                            title={group.name}
                            secondary={classId !== group.id}
                            onPress={() => {
                              setClassId(group.id);
                              resetEnrollment();
                            }}
                          />
                        ))}
                      {enrollmentFields}
                    </>
                  )}
                  {school && !groups.some((group) => group.feePlan) && (
                    <>
                      <Field
                        label="Total tuition fee (₹, before concession)"
                        keyboardType="decimal-pad"
                        editable={profile?.standardFeePaise === undefined}
                        value={
                          profile?.standardFeePaise
                            ? (profile.standardFeePaise / 100).toFixed(2)
                            : tuition
                        }
                        onChangeText={setTuition}
                      />
                      <Field
                        label="Hostel fee (₹, optional)"
                        keyboardType="decimal-pad"
                        value={hostel}
                        onChangeText={setHostel}
                      />
                    </>
                  )}
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
                          ...(classId
                            ? { groupId: classId, ...enrollment }
                            : {}),
                          ...(school && !classId
                            ? {
                                feePaise: tuition.trim()
                                  ? rupeesToPaise(tuition)
                                  : undefined,
                                hostelFeePaise:
                                  hostel.trim() && Number(hostel) !== 0
                                    ? rupeesToPaise(hostel)
                                    : 0,
                              }
                            : {}),
                          externalRef: memberRef || undefined,
                          guardians: phone ? [{ name: guardian, phone }] : [],
                        });
                        setMemberName("");
                        setClassId("");
                        resetEnrollment();
                        setTuition("");
                        setHostel("");
                        setMemberRef("");
                        setPhone("");
                        setGuardian("");
                        await refresh();
                      })
                    }
                  />
                </Card>
              )}
              {manageRole && (
                <Card>
                  <Text style={styles.label}>Import members from CSV</Text>
                  <Field
                    label="Paste CSV"
                    placeholder="name,externalRef,guardianName,phone"
                    multiline
                    autoCapitalize="none"
                    value={memberCsv}
                    onChangeText={(value) => {
                      setMemberCsv(value);
                      setCsvRows([]);
                    }}
                  />
                  <Button
                    title="Preview CSV"
                    secondary
                    disabled={!memberCsv.trim()}
                    onPress={() =>
                      void act(async () => {
                        const result = await request<{ rows: typeof csvRows }>(
                          "/v1/members/import",
                          "POST",
                          { csv: memberCsv },
                        );
                        setCsvRows(result.rows);
                      })
                    }
                  />
                  {csvRows.slice(0, 20).map((row) => (
                    <Text key={row.row} style={styles.sub}>
                      {row.row}. {row.name} · {row.errors.join(", ") || "Ready"}
                    </Text>
                  ))}
                  {!!csvRows.length && (
                    <Button
                      title={`Import ${csvRows.length} members`}
                      disabled={csvRows.some((row) => row.errors.length > 0)}
                      onPress={() =>
                        void act(async () => {
                          const result = await request<{ imported: number }>(
                            "/v1/members/import",
                            "POST",
                            { csv: memberCsv, confirm: true },
                          );
                          setMemberCsv("");
                          setCsvRows([]);
                          await refresh();
                          setNotice(`${result.imported} members imported.`);
                        })
                      }
                    />
                  )}
                </Card>
              )}
              {members
                .filter((m) => matchesMember(m, memberQuery))
                .map((m) => (
                  <Card key={m.id}>
                    <Text style={styles.label}>{m.name}</Text>
                    <Text style={styles.sub}>
                      Paid {money(m.totals?.paidPaise ?? 0)} · Due now{" "}
                      {money(m.totals?.duePaise ?? 0)} · Total remaining{" "}
                      {money(m.totals?.remainingPaise ?? 0)}
                    </Text>
                    <Button
                      title="Payments"
                      secondary
                      onPress={() =>
                        void act(() => openMemberPayments(m.id, m.name))
                      }
                    />
                    <Text style={styles.sub}>
                      {m.externalRef ?? "No reference"} ·{" "}
                      {m.guardians[0]?.phone.replace(/.(?=.{4})/g, "•") ??
                        "No contact"}
                    </Text>
                    {session.user.profile !== "RESTAURANT" && (
                      <Text style={styles.sub}>
                        Concession {m.concessionPercent ?? 0}%
                        {m.feePaise ? ` · Tuition ${money(m.feePaise)}` : ""}
                        {m.hostelFeePaise
                          ? ` · Hostel ${money(m.hostelFeePaise)}`
                          : ""}
                      </Text>
                    )}
                    {manageRole && session.user.profile !== "RESTAURANT" && (
                      <>
                        {feeMember === m.id ? (
                          <>
                            <Field
                              label="Concession (%)"
                              keyboardType="number-pad"
                              value={concession}
                              onChangeText={setConcession}
                            />
                            <Button
                              title="Save concession"
                              disabled={
                                !/^\d{1,3}$/.test(concession) ||
                                Number(concession) > 100
                              }
                              onPress={() =>
                                void act(async () => {
                                  await request(
                                    `/v1/members/${m.id}/fees`,
                                    "PUT",
                                    { concessionPercent: Number(concession) },
                                  );
                                  setFeeMember("");
                                  await refresh();
                                })
                              }
                            />
                          </>
                        ) : (
                          <Button
                            title="Edit concession"
                            secondary
                            onPress={() => {
                              setFeeMember(m.id);
                              setConcession(String(m.concessionPercent ?? 0));
                            }}
                          />
                        )}
                      </>
                    )}
                    {session &&
                      m.guardians.map((contact) => {
                        const optedIn = Boolean(
                          contact.whatsappConsentedAt && !contact.optOut,
                        );
                        return (
                          <View key={contact.id}>
                            <Button
                              title={
                                optedIn
                                  ? "Withdraw WhatsApp permission"
                                  : "Record WhatsApp permission"
                              }
                              secondary
                              onPress={() => {
                                setConsentEvidence("");
                                setConsentGuardian(contact.id);
                              }}
                            />
                            {consentGuardian === contact.id && (
                              <>
                                <Field
                                  label="Permission evidence"
                                  value={consentEvidence}
                                  onChangeText={setConsentEvidence}
                                />
                                <Button
                                  title="Save WhatsApp permission"
                                  disabled={consentEvidence.trim().length < 3}
                                  onPress={() =>
                                    void act(async () => {
                                      await request(
                                        `/v1/members/${m.id}/guardians/${contact.id}/whatsapp-consent`,
                                        "PUT",
                                        {
                                          optIn: !optedIn,
                                          evidence: consentEvidence,
                                        },
                                      );
                                      setConsentGuardian("");
                                      setConsentEvidence("");
                                      await refresh();
                                    })
                                  }
                                />
                              </>
                            )}
                          </View>
                        );
                      })}
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
                title={school ? "Classes & fees" : "Programs & fees"}
                sub="Fees and reminders follow India Standard Time."
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
                        label={
                          school
                            ? "Annual tuition (₹)"
                            : "Program fee for the term (₹)"
                        }
                        keyboardType="decimal-pad"
                        value={fee}
                        onChangeText={setFee}
                      />
                      {school ? (
                        <>
                          <Field
                            label="Academic year starts (YYYY-MM)"
                            value={academicMonth}
                            onChangeText={setAcademicMonth}
                          />
                          <Field
                            label="Optional annual hostel fee (₹)"
                            keyboardType="decimal-pad"
                            value={classHostel}
                            onChangeText={setClassHostel}
                          />
                        </>
                      ) : (
                        <>
                          <Button
                            title={
                              sportsMode === "SPORTS_RENEWAL"
                                ? "Renewable membership"
                                : "Fixed-term coaching"
                            }
                            secondary
                            onPress={() =>
                              setSportsMode(
                                sportsMode === "SPORTS_RENEWAL"
                                  ? "SPORTS_FIXED"
                                  : "SPORTS_RENEWAL",
                              )
                            }
                          />
                          <Text style={styles.label}>Term length</Text>
                          {[1, 3, 6, 12].map((months) => (
                            <Button
                              key={months}
                              title={`${months} months`}
                              secondary={termMonths !== months}
                              onPress={() => setTermMonths(months)}
                            />
                          ))}
                        </>
                      )}
                      <Field
                        label="Additional charges"
                        multiline
                        value={extraCharges}
                        onChangeText={setExtraCharges}
                        placeholder={
                          school
                            ? "Books, 3000, upfront, required"
                            : "Registration, 500, upfront, required"
                        }
                      />
                      <Text style={styles.sub}>
                        One charge per line: name, amount in rupees, upfront or
                        spread, required or optional.
                      </Text>
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
                              feePlan: school
                                ? {
                                    mode: "SCHOOL",
                                    startsOn: academicMonth.trim() + "-01",
                                    hostelPaise:
                                      classHostel.trim() &&
                                      Number(classHostel) !== 0
                                        ? rupeesToPaise(classHostel)
                                        : 0,
                                    charges: parseFeeCharges(extraCharges),
                                  }
                                : {
                                    mode: sportsMode,
                                    months: termMonths,
                                    charges: parseFeeCharges(extraCharges),
                                  },
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
                    {selected.feePlan
                      ? selected.feePlan.mode === "SCHOOL"
                        ? "Academic year starts " + selected.feePlan.startsOn
                        : selected.feePlan.months + "-month program"
                      : "Next cycles: " +
                        (selected.nextBillDates?.join(" · ") ||
                          "No future cycles")}
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
                  {manageRole && !selected.feePlan && (
                    <>
                      <Text style={styles.label}>WhatsApp reminder policy</Text>
                      <Field
                        label="Days relative to due date"
                        value={reminderOffsets}
                        onChangeText={setReminderOffsets}
                      />
                      <Field
                        label="Send time (HH:MM IST)"
                        value={reminderTime}
                        onChangeText={setReminderTime}
                      />
                      <View style={styles.row}>
                        <Switch
                          value={reminderHindi}
                          onValueChange={setReminderHindi}
                          accessibilityLabel="Use Hindi for WhatsApp reminders"
                        />
                        <Text style={styles.sub}>
                          Use Hindi for WhatsApp reminders
                        </Text>
                      </View>
                      <Button
                        title="Save reminder policy"
                        secondary
                        onPress={() =>
                          void act(async () => {
                            const offsets = reminderOffsets.trim()
                              ? reminderOffsets
                                  .split(",")
                                  .map((item) => Number(item.trim()))
                              : [];
                            await request(
                              `/v1/groups/${selected.id}/reminders`,
                              "PUT",
                              offsets.map((offsetDays) => ({
                                offsetDays,
                                sendTimeIST: reminderTime,
                                language: reminderHindi ? "hi" : "en",
                                channels: ["WHATSAPP"],
                              })),
                            );
                            await openGroup(selected.id);
                            setNotice("Reminder policy saved.");
                          })
                        }
                      />
                    </>
                  )}
                  <Text style={styles.label}>Active memberships</Text>
                  {selected.memberships
                    ?.filter((m) => !m.leftAt)
                    .map((m) => (
                      <View key={m.id} style={{ gap: 8 }}>
                        <Text>{m.member.name}</Text>
                        {m.accessStatus && (
                          <Text style={styles.sub}>
                            {m.accessStatus === "ACTIVE"
                              ? "Access active"
                              : "Access paused"}
                            {m.paidThrough
                              ? ` · Paid until ${m.paidThrough}`
                              : ""}
                          </Text>
                        )}
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
                  {selected.feePlan
                    ? enrollmentFields
                    : manageRole && (
                        <Field
                          label="Optional fee override when adding a member (₹)"
                          keyboardType="decimal-pad"
                          value={overrideFee}
                          onChangeText={setOverrideFee}
                        />
                      )}
                  {(manageRole || selected.feePlan) &&
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
                          title={`Enroll ${m.name}`}
                          secondary
                          busy={busy}
                          onPress={() =>
                            void act(async () => {
                              const body = {
                                memberId: m.id,
                                ...(selected.feePlan
                                  ? enrollment
                                  : overrideFee.trim()
                                    ? {
                                        amountPaise: rupeesToPaise(overrideFee),
                                      }
                                    : {}),
                              };
                              await request(
                                `/v1/groups/${selected.id}/members`,
                                "POST",
                                body,
                                keyFor({ group: selected.id, ...body }),
                              );
                              setOverrideFee("");
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
              {bills.map((b) => (
                <Card key={b.id}>
                  <Text style={styles.label}>{b.purpose}</Text>
                  <Text style={styles.title}>
                    {money(b.amountPaise - b.paidPaise)}
                  </Text>
                  <Text style={styles.sub}>
                    {b.status} · Paid {money(b.paidPaise)}
                    {b.plannedTotalPaise !== undefined
                      ? ` · Plan total ${money(b.plannedTotalPaise)}`
                      : ""}
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
                  {(financeRole || restaurant) &&
                    (b.plannedTotalPaise !== undefined ||
                      ["ISSUED", "PARTIAL", "EXPIRED"].includes(b.status)) &&
                    b.paidPaise <
                      Math.max(b.plannedTotalPaise ?? 0, b.amountPaise) && (
                      <Button
                        title="Record verified payment"
                        secondary
                        onPress={() => chooseVerification(b)}
                      />
                    )}
                </Card>
              ))}
              {!bills.length && !refreshing && (
                <Text style={styles.sub}>No bills found.</Text>
              )}
            </>
          )}
          {tab === "Reminders" && (
            <>
              <Heading
                title="Reminders & billing jobs"
                sub="Eligible WhatsApp drafts open for you to send."
              />
              {manageRole && (
                <Button
                  title="Check eligible billing"
                  busy={busy}
                  onPress={() =>
                    void act(async () => {
                      const result = await request<{ issued: number }>(
                        "/v1/billing/run",
                        "POST",
                        {},
                      );
                      await refresh();
                      setNotice(`${result.issued} eligible bills issued.`);
                    })
                  }
                />
              )}
              {reminderRows.map((row) => (
                <Card key={row.id}>
                  <Text style={styles.label}>{row.bill.purpose}</Text>
                  <Text style={styles.sub}>
                    {money(row.bill.amountPaise - row.bill.paidPaise)} ·{" "}
                    {row.status}
                  </Text>
                  <Text style={styles.sub}>
                    {new Date(row.scheduledAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}{" "}
                    IST
                  </Text>
                  {!!row.failureReason && (
                    <Text style={styles.sub}>{row.failureReason}</Text>
                  )}
                  {row.bill.memberId && (
                    <Button
                      title="Member payments"
                      secondary
                      onPress={() =>
                        void act(() =>
                          openMemberPayments(
                            row.bill.memberId!,
                            row.bill.purpose,
                            row.bill.id,
                          ),
                        )
                      }
                    />
                  )}
                  {["READY", "OPENED"].includes(row.status) && (
                    <Button
                      title="Open WhatsApp"
                      onPress={() =>
                        void act(async () => {
                          const result = await request<{ whatsappUrl: string }>(
                            "/v1/reminders/resend",
                            "POST",
                            {
                              occurrenceId: row.id,
                              webOrigin: process.env.EXPO_PUBLIC_WEB_URL,
                            },
                          );
                          await Linking.openURL(result.whatsappUrl);
                        })
                      }
                    />
                  )}
                </Card>
              ))}
              {!reminderRows.length && (
                <Text style={styles.sub}>
                  No reminders yet. Reminders appear after a group bill is
                  issued for a member with a guardian.
                </Text>
              )}
            </>
          )}
          {tab === "Settings" && (
            <>
              <Heading title="Your workspace." />
              {manageRole && session.user.profile === "SCHOOL" && (
                <Card>
                  <Field
                    label="Legacy group tuition per billing cycle (₹)"
                    keyboardType="decimal-pad"
                    value={standardFee}
                    onChangeText={setStandardFee}
                  />
                  <Button
                    title="Save standard tuition"
                    disabled={!standardFee.trim()}
                    onPress={() =>
                      void act(async () => {
                        const school = await request<SchoolProfile>(
                          "/v1/local/school-fee",
                          "PUT",
                          { feePaise: rupeesToPaise(standardFee) },
                        );
                        setProfile(school);
                        setNotice("Standard tuition saved.");
                      })
                    }
                  />
                </Card>
              )}
              {manageRole && (
                <Card>
                  <Text style={styles.label}>
                    WhatsApp reminder limits · IST
                  </Text>
                  {(
                    [
                      ["reminderStartHour", "Start hour (0–23)"],
                      ["reminderEndHour", "End hour (1–24)"],
                      ["reminderDailyCap", "Daily cap per recipient (1–10)"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field
                      key={key}
                      label={label}
                      keyboardType="number-pad"
                      value={String(reminderLimits[key])}
                      onChangeText={(value) => {
                        if (/^\d{0,2}$/.test(value))
                          setReminderLimits({
                            ...reminderLimits,
                            [key]: Number(value),
                          });
                      }}
                    />
                  ))}
                  <Button
                    title="Save reminder limits"
                    secondary
                    onPress={() =>
                      void act(async () => {
                        await request(
                          "/v1/reminder-settings",
                          "PUT",
                          reminderLimits,
                        );
                        setNotice("Reminder limits saved.");
                      })
                    }
                  />
                </Card>
              )}
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
                  {profile?.storage === "cloud"
                    ? "Google Drive storage"
                    : "Device storage"}
                </Text>
                {cloud && (
                  <Text selectable style={styles.sub}>
                    Cloud workspace ID {cloud.workspaceId}
                  </Text>
                )}
                {!!syncStatus && (
                  <Text accessibilityLiveRegion="polite" style={styles.sub}>
                    {syncStatus}
                  </Text>
                )}
                {cloud && (
                  <Button
                    title="Sync Google Drive now"
                    secondary
                    onPress={() =>
                      void act(async () =>
                        setSyncStatus(await syncCloud(cloud)),
                      )
                    }
                  />
                )}
                <Text style={styles.sub}>
                  Direct UPI · Razorpay (coming later)
                </Text>
                {session.user.roles.includes("OWNER" as never) && (
                  <>
                    <Field
                      label="UPI address"
                      autoCapitalize="none"
                      value={vpa}
                      onChangeText={setVpa}
                    />
                    <Button
                      title="Save UPI address"
                      disabled={!validVpa(vpa)}
                      secondary
                      onPress={() =>
                        void act(async () => {
                          setProfile(
                            await request<SchoolProfile>(
                              "/v1/local/profile",
                              "POST",
                              { vpa },
                            ),
                          );
                          setPay(null);
                          setNotice("UPI address saved.");
                        })
                      }
                    />
                  </>
                )}
                <Button
                  title="Sign out"
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
