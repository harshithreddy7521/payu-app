# Android and iOS application

## Implemented

The Expo entry point now starts the staff application on both platforms. It has
secure-store sessions, sign-in/restore/sign-out, foreground session checks,
Quick Pay as the initial screen, branch selection, UPI QR and OS share actions,
dashboard, member creation/archival, monthly group preview/create, enrollment,
removal and pause/resume, transactions and attributed receipts, staff-verified
payments, refund requests, destination review requests and finance lists.
Owners/finance see finance actions; the server independently refreshes grants
and enforces permissions. Form contents survive request failures. Reads support
pull-to-refresh. Writes require connectivity and are not silently queued offline.
Quick Pay/enrollment/refund retries retain a logical request key. Monetary inputs
reject extra decimals instead of rounding. Release HTTP connections and URLs
containing credentials are rejected. Tokens are stored using platform secure
storage, never AsyncStorage. Sign-out clears session and loaded business data.

Notifications are paused by default (`NOTIFICATIONS_ENABLED=false`). Billing
still runs. Destination approval means independent review, not bank verification;
only the last four digits and IFSC are stored in this pre-provider review flow.
No real beneficiary verification, refund execution or payout is claimed.

## Local startup

From the repository root:

```sh
npm ci
cd apps/mobile
cp .env.example .env
# Set EXPO_PUBLIC_API_URL to your reachable staging API or development LAN IP.
npm run dev
```

Use a development build/compatible Expo client. A physical phone cannot reach
your computer through `localhost`. Android emulator development defaults to
`10.0.2.2:3001`; iOS simulator defaults to localhost. For iOS physical devices use
HTTPS staging; the app does not enable blanket insecure App Transport Security.
Start the API and PostgreSQL separately as described in the root README.
Never put private payment/provider credentials in EXPO_PUBLIC_* variables.

## Verification

```sh
npm run typecheck --workspace=@fee/mobile
./node_modules/.bin/tsx --test apps/mobile/src/lib/validation.test.ts
npm run export:android --workspace=@fee/mobile
npm run export:ios --workspace=@fee/mobile
RUN_DB_TESTS=1 npm test --workspace=@fee/api
```

Exports validate the Android/iOS JS and asset bundles; they are not signed APK,
AAB or IPA binaries and do not prove native device behavior. The Cloud workspace
has no Android emulator/adb or macOS/Xcode/iOS simulator. Actual native UI,
secure-storage, OS share and UPI handoff tests remain release gates.

## Signing and deployment (owner action required)

1. Choose/confirm unique Android package and Apple bundle identifiers in
   `app.config.ts`. The supplied `com.feeflow.staff` values must be checked for
   your ownership/availability before publication. Add owned icons, splash assets,
   support URL, privacy policy and store descriptions.
2. Create an Expo/EAS project in your account (`eas login`, `eas init`). Store the
   resulting project ID in app config. No Expo account is linked by this change.
3. Set `EXPO_PUBLIC_API_URL` in each EAS environment to a deployed HTTPS backend.
   Configure unique backend JWT secrets, explicit CORS origins, migrations,
   backups, monitoring and worker supervision. Keep notifications disabled.
4. Install the development-client package using `npx expo install expo-dev-client`
   when using the EAS development profile, then create development builds with
   `eas build --profile development --platform all`.
5. Use `eas build --profile preview --platform android` for an internal Android
   APK. An iOS internal build needs Apple signing/provisioning and registered
   devices; TestFlight needs your Apple Developer/App Store Connect account.
6. Test the current Expo SDK/RN stack on supported devices. Confirm its target
   SDK/Xcode versions satisfy the stores' requirements at submission time.
7. After all gates below pass, use `eas build --profile production --platform all`.
   Production EAS builds increment version codes. Upload with your own store
   credentials; this task neither signs nor submits an application.

## Mandatory release gates still open

- Physical Android and iOS test matrix: session expiry/revocation, background and
  foreground, failed network, large text, screen readers, safe areas/keyboard,
  QR readability, UPI installed/not installed, share sheet and app restart.
- Independent security review, complete role/tenant test matrix and penetration
  test; production MFA and onboarding are not implemented by this increment.
- Backup/restore proof, operational alerts and load tests on the deployed stack.
- Real payment partner onboarding, verified beneficiaries, signed callbacks,
  original-rail refunds, payout reservations/reconciliation and failure recovery.
  Personal-VPA collection with manual verification does not replace these.
- Full native parity beyond this increment: bulk CSV mapping/import UI, detailed
  reminder-policy/consent screens, organisation/staff administration and in-app
  printable receipts. Receipts are currently listed in Transactions; printing
  remains available through web checkout.
- Meta approval/integration and consent-aware delivery tests before enabling
  notifications. SMS remains deferred.

The implementation is runnable cross-platform source with tested bundles, not a
claim that App Store/Play approval or production readiness has been achieved.
