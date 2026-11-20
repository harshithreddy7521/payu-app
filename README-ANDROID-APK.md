# Build a signed Feeflow Android APK on macOS

This guide builds the **single-device, offline Android edition** for direct
installation. No Play Store account, publishing fee, API server or Expo cloud
build account is required. The build computer needs Internet access to download
tools/dependencies; the installed production app uses local encrypted storage.

Support: **harshithhari.bh@gmail.com**.

## 1. Install prerequisites

Install:

- Node.js 22 or newer, with npm.
- Python 3.
- **JDK 21**. Xcode's tools do not include the Android SDK/JDK setup.
- **Android Studio**, then complete its initial setup.

Allow at least **15–20 GB free disk space** for downloads, SDKs and build caches.
This project uses Expo SDK 58. The script targets **ARM64 Android phones**; its
APK is not an x86 emulator build. Native device validation is still required.

Check your tools in macOS Terminal:

```sh
node --version
npm --version
python3 --version
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
java -version
```

If `java_home` cannot find version 21, install JDK 21 before continuing.

## 2. Install and configure the Android SDK

In Android Studio, open **Settings → Languages & Frameworks → Android SDK**
(or **More Actions → SDK Manager** on the welcome screen).

Note **Android SDK Location**. Usually it is:

```text
/Users/YOUR_MAC_USERNAME/Library/Android/sdk
```

Under **SDK Tools**, install **Android SDK Command-line Tools (latest)** and
**Android SDK Platform-Tools**. Apply the changes.

In the **same Terminal tab** you will use for the build, run:

```sh
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

ls "$ANDROID_HOME"
sdkmanager --version
```

If Android Studio shows another location, replace the `ANDROID_HOME` value.
A valid SDK normally contains directories such as `platform-tools`, `platforms`,
`build-tools` and `cmdline-tools`.

Review/accept the SDK licences and install this project's build components:

```sh
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-37.0" \
  "build-tools;37.0.0" "build-tools;36.0.0" \
  "ndk;27.1.12297006" "cmake;3.22.1"
```

To retain the environment across Terminal sessions, add the three `export` lines
to `~/.zshrc` and run `source ~/.zshrc`. Do not add signing passwords there.

## 3. Get the current source and dependencies

From your checkout (adjust the path if necessary):

```sh
cd ~/Desktop/payu-app
git pull origin master
npm ci
```

Keep all following build commands at the repository root. The offline edition
does **not** need `EXPO_PUBLIC_API_URL`, PostgreSQL, the API or the worker. An
existing `.env` notice from Expo is not evidence that this app uses the API.

## 4. Create your private signing key — once only

**Skip this section if you already created the Feeflow signing files. Reuse them.**
Every update must use the same signing key and package ID. Store signing files
outside the Git checkout and keep a secure external backup. Never paste the
password into chat or commit/upload these files publicly.

```sh
mkdir -p "$HOME/FeeflowSigning"
chmod 700 "$HOME/FeeflowSigning"

keytool -genkeypair \
  -keystore "$HOME/FeeflowSigning/feeflow-release.p12" \
  -storetype PKCS12 \
  -alias feeflow \
  -keyalg RSA \
  -keysize 3072 \
  -validity 10000 \
  -dname "CN=Feeflow Android, OU=Android, O=Feeflow, C=IN"

chmod 600 "$HOME/FeeflowSigning/feeflow-release.p12"
```

Enter a strong password when `keytool` prompts. Keep it in your password manager.
Do not put it directly into a shell command.

Create the credentials file by entering that **same keystore password** below.
The script validates it with `keytool`. It refuses to overwrite an existing
credentials file, so run it only when creating the signing configuration.

```sh
python3 - <<'PY'
from pathlib import Path
import getpass
import json
import os
import subprocess

folder = Path.home() / "FeeflowSigning"
credentials = folder / "signing-credentials.json"
if credentials.exists():
    raise SystemExit("Credentials already exist. Reuse them; do not overwrite.")

password = getpass.getpass("Keystore password: ")
env = dict(os.environ, FEEFLOW_STORE_PASSWORD=password)
subprocess.run([
    "keytool", "-list",
    "-keystore", str(folder / "feeflow-release.p12"),
    "-alias", "feeflow",
    "-storepass:env", "FEEFLOW_STORE_PASSWORD",
], env=env, check=True)

fd = os.open(credentials, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    json.dump({"alias": "feeflow", "storePassword": password}, stream)
print("Private signing configuration created.")
PY
```

The folder contains:

```text
FeeflowSigning/
  feeflow-release.p12
  signing-credentials.json
```

The JSON file contains the password in plaintext: protect it along with the key.
These are APK signing credentials, **not** your app administrator password or
backup-file passphrase. Do not distribute them with the APK.

## 5. Build the signed release APK

From the repository root:

```sh
python3 apps/mobile/scripts/build-offline-android.py \
  --keystore "$HOME/FeeflowSigning/feeflow-release.p12" \
  --credentials "$HOME/FeeflowSigning/signing-credentials.json" \
  --gradle-direct-download \
  --gradle-download-timeout 180000
```

The script:

1. Generates Android native files with production configuration.
2. Configures SQLCipher and release signing; it does not use the debug key for release.
3. Applies the Gradle download timeout **after** Expo prebuild.
4. Bootstraps Gradle, retrying download failures up to three times.
5. Builds the ARM64 release APK. Compilation/signing errors are not blindly retried.

The first build may take a while because it downloads Gradle and dependencies.
Do not regard warnings, successful prebuild or a bundle export as a completed APK.
Look for `BUILD SUCCESSFUL` and the script's `Signed APK:` output.

Expected file, relative to the repository root:

```text
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Verify the APK signature:

```sh
"$ANDROID_HOME/build-tools/37.0.0/apksigner" verify \
  --verbose --print-certs \
  apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Compare its signer certificate with your key's certificate:

```sh
keytool -list -v \
  -keystore "$HOME/FeeflowSigning/feeflow-release.p12" \
  -alias feeflow
```

Keep the SHA-256 certificate fingerprint for checking future releases. It is
public metadata; the key and password must remain private.

## 6. Install on your Android phone

Transfer **only the APK** to the phone. Open it and, when Android prompts, allow
installation from that particular file-manager/browser source. You can disable
that source's permission again afterwards. Do not disable Play Protect globally.

Alternatively, enable USB debugging, connect your own phone and approve its USB
prompt, then run:

```sh
adb devices
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

`-r` requests an update while preserving application data. Installation can still
fail if the existing package was signed with a different key.

The current package ID is `com.feeflow.staff`. Expo Go cannot run this project's
custom SQLCipher configuration; test the actual installed native APK.

## 7. First use and backup acceptance test

1. Choose **Create a school account**, enter school and administrator details, and set the school UPI address. Then sign in.
2. Add a collector and verify export/import controls are hidden for that account.
3. Create sample members, groups and bills; record a **synthetic** test payment.
4. As admin, use **Settings → Admin controls → Export all tables**. Supply the
   admin password and a separate backup passphrase of at least 12 characters.
5. Save the encrypted `.feeflow` file off-device and confirm the file exists.
6. On a second test installation/device, create a temporary administrator, sign
   in and import the file. Restore replaces all tables and invalidates sessions.
7. Sign in with an administrator account/password **from the backup**. Verify
   records, receipt amounts and collector permissions. Test wrong-passphrase and
   damaged-file rejection before trusting backup recovery.
8. Check app locking after background/restart and UPI handoff on your own phone.

The offline edition uses on-device storage. For a cloud-enabled APK, set
`EXPO_PUBLIC_WEB_URL` to the HTTPS web console before building. See the main
README for Google Drive setup. Direct UPI QR requests can transfer real money; a scan/app return never
marks a bill paid. Admin staff must verify the receiving account first.

Existing server/web data is not automatically migrated into the local edition.
Uninstalling/clearing app storage can permanently lose data without an external
backup. Keep the backup passphrase separately; support cannot recover it.

## 8. Building future updates

- Keep the same package ID and release keystore.
- Increase `android.versionCode` in `apps/mobile/app.config.ts` for each release;
  update the display `version` as appropriate.
- Pull code, run `npm ci`, rebuild with the same command, and verify its signature.
- Export and verify a current backup before installing an update.
- Test update-in-place with `adb install -r`; do not uninstall as a troubleshooting
  shortcut when the device holds financial records.

## Troubleshooting

### `SDK location not found`

Verify `ANDROID_HOME` matches Android Studio's SDK Location and is exported in
**the same Terminal tab** running Python. Run `ls "$ANDROID_HOME"`.
Do not rely on editing `android/local.properties`: Expo prebuild regenerates the
native project. Persistent environment configuration is the reliable option.

### Gradle download timeout / `ConnectException`

Use the command in section 5. `--gradle-direct-download` selects the official
`downloads.gradle.org` host; `--gradle-download-timeout 180000` sets three minutes.
A retry can succeed after the initial connection fails. A longer timeout cannot
fix a blocked host: check VPN/proxy/firewall settings or try a trusted alternative
network. Java/Gradle may need explicit proxy configuration on managed networks.
Never disable TLS certificate verification or download Gradle from random mirrors.

### Missing SDK, NDK, CMake or unaccepted licence

Run section 2's `sdkmanager` commands. Use Android Studio's SDK Manager if
`sdkmanager` is not found. Build errors name the missing component; install that
component and retry. Do not change project versions at random.

### Keystore/password/alias error

The alias must be `feeflow`. Validate the key with `keytool -list` as above and
check that the credentials file has matching `alias` and `storePassword` values.
Do not generate another key to fix an update/signing error.

### `No space left on device`

Free build-machine disk space and retry. SDK/NDK extraction and Gradle caches can
consume several GB. Never delete signing files or a phone's app data to free
build space. The cloud workspace previously failed for this reason; no successful
signed APK from that failed attempt is claimed.

### Kotlin, AGP deprecation and `expo-system-ui` warnings

These notices alone do not mean the build failed. Find the first relevant error
under `FAILURE: Build failed` / `What went wrong`. The `expo-system-ui` notice is
unrelated to SDK-location and Gradle-download failures.

### Screenshots are blank / app locks when backgrounded

The native privacy flag blocks screenshots; app locking protects local records.
The system backup/share chooser has a short exception to allow export/import.
Re-authenticate if a long chooser operation expires that allowance.

## Related documentation

- [Offline data, encryption and backup behavior](docs/android-offline.md)
- [Earlier cross-platform implementation and release gates](docs/mobile-release.md)

A signed APK is not evidence of a complete security review or production
acceptance. Perform the physical-device, backup/restore and upgrade tests before
storing real financial records.
