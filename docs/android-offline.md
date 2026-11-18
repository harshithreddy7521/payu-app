# Feeflow: single-device Android edition

Support: harshithhari.bh@gmail.com. No subscription or store publication is
required. The Android entry point now opens the local edition. The server/web
project remains separate and its database is not deleted or automatically copied.

## Features and boundaries

- Local administrator setup with no default/demo password. Passwords are scrypt
  verifiers with per-account random salts. Collector accounts have no backup or
  payment-verification authority. Administrators can export/import all tables.
- SQLCipher-encrypted SQLite database. A random database key is kept in Android
  secure storage; the app refuses to open a plaintext SQLite fallback.
- Lock on process start/background; short-lived file picker/share operations are
  allowed to complete. After restart, sign in again. Failed unlock attempts are
  throttled locally. Device rooting/OS compromise is outside this protection.
- Members, group enrollment/removal/pause, monthly local billing, Quick Pay,
  direct UPI QR/share, manual payment verification, receipts and dashboard.
  Billing runs when the app opens/refreshes; Android does not run this scheduler
  while the app is closed. This local edition currently issues the current month,
  not historical periods. Public web checkout, notifications, payouts and provider
  refunds are unavailable. UPI transfers still need the payer's network/UPI app.
- No cloud sync. Release builds block the Android Internet permission. Data is
  only copied off-device when the admin explicitly exports/shares a backup.
- Existing cloud/server records are NOT automatically migrated into this edition.
  Version-1 local backups are the supported restore format.

## Backup and restore

Settings → Admin controls is visible only to OWNER accounts (labelled admin).
The underlying service also checks the active administrator account and asks for
its current password. A collector cannot export/restore by calling that service.

Choose a separate backup passphrase of at least 12 characters. Export writes one
`.feeflow` file containing every application table: users/password verifiers,
branches, members/guardian contacts, groups, memberships, bills, payments,
receipts, ledger, settings, audit and request replay records. Device-bound keys
and active sessions are not exported. AES-256-GCM protects confidentiality and
integrity; scrypt derives the key from the passphrase with a fresh salt, and each
file uses a new nonce. The temporary cache copy is removed after sharing.

Save the file outside the phone, then verify that the file actually exists in
your selected destination. A completed Android share sheet is not proof of a
backup. Keep the passphrase separately; it cannot be recovered by support.

On a new device, install the APK, create a temporary local administrator and sign
in. Use Admin controls → Import. Enter that temporary admin's password and the
backup's passphrase. Confirm replacement. The app authenticates/decrypts the file,
checks its schema and financial relationships, then replaces all tables in a
single SQLite transaction. Failed validation leaves existing data intact. A
successful restore invalidates every session: sign in with an admin account and
password FROM THE BACKUP. The temporary account is replaced.

Uninstall/clear storage/lose the phone without an external backup and the local
records may be permanently lost. Native backup is disabled to avoid an Android
backup containing a database without its device-bound encryption key.

## Build an APK locally

Expo Go does not include this project's SQLCipher configuration. Use the signed
native APK, or a custom native development build. No API URL is required.

Install Node, JDK 21 and Android Studio/SDK (with the platform/build tools and NDK
requested by this Expo/RN version), then run `npm ci` from the repository root.
Keep the signing files outside the checkout. From `apps/mobile`:

```sh
python3 scripts/build-offline-android.py \
  --keystore /private/path/feeflow-release.p12 \
  --credentials /private/path/signing-credentials.json
```

The script prebuilds Android in production mode, uses the release signing config
(never the debug keystore), and builds an ARM64 APK for current Android phones.
Generated native directories/APKs and signing secrets are ignored by Git. For
future updates, keep package ID `com.feeflow.staff`, retain the same keystore,
and increment Android `versionCode` in app config. Install the new APK over the
old one; do not uninstall unless you have verified a backup. Changing/loss of the
signing key prevents in-place updates and may force backup/reinstallation.

The release keystore was generated for this project. Its credentials are private
and must not be pasted into chat, committed, or uploaded to a public repository.
A local build is free of Play Store publishing fees. Signing is not evidence of
runtime/security validation.

## Checks and release gates

Type checks, Android bundle export and SQLite/cryptographic regression tests are
available. Tests cover offline operation, roles, retry keys, duplicate/excess
payments, locks, encrypted round-trip, tampering, invalid schema/relationships,
and admin-only full restore. Native SQLCipher, Android file pickers, background
locking and cross-device restoration still require physical-device acceptance.
Before using real financial data: verify export → external save → fresh-device
restore, wrong-passphrase behavior, collector restrictions, app upgrade retention,
UPI handoff, and signed APK certificate/manifest. Maintain independent backups.

## Gradle distribution download timeout

The build needs Internet access to download Gradle, SDKs and Maven dependencies;
the installed offline app does not. The script applies a 120-second wrapper
network timeout after Expo prebuild and retries distribution bootstrap three
times. Native compilation/signing failures are not automatically retried.

If the services.gradle.org redirect cannot connect, retry the same build using
`--gradle-direct-download` to use the official downloads.gradle.org host. You can
also set `--gradle-download-timeout 180000`. Existing checksums are preserved;
TLS verification is never disabled. A longer timeout cannot fix a blocked host:
check your VPN/proxy/firewall or try another trusted network if both hosts fail.
The Expo `expo-system-ui` notice is unrelated to a Gradle download timeout.
