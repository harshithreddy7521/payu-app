import type { ExpoConfig } from "expo/config";
export default (): ExpoConfig => ({
  name: "Feeflow",
  slug: "feeflow",
  version: "0.2.0",
  scheme: "feeflow",
  orientation: "default",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.feeflow.staff",
    infoPlist: { NSAppTransportSecurity: { NSAllowsArbitraryLoads: false } },
  },
  android: {
    package: "com.feeflow.staff",
    versionCode: 2,
    permissions: [],
    allowBackup: false,
    blockedPermissions:
      process.env.APP_VARIANT === "production" && !process.env.EXPO_PUBLIC_WEB_URL
        ? [
            "android.permission.INTERNET",
            "android.permission.ACCESS_NETWORK_STATE",
          ]
        : [],
  },
  plugins: [
    "expo-secure-store",
    ["expo-sqlite", { useSQLCipher: true }],
    "./plugins/withReleaseSigning",
    "./plugins/withAndroidPrivacy",
  ],
  extra: { releaseStage: process.env.APP_VARIANT ?? "development" },
});
