import type { ExpoConfig } from "expo/config";
export default (): ExpoConfig => ({
  name: "Feeflow",
  slug: "feeflow",
  version: "0.1.0",
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
    permissions: [],
    allowBackup: false,
  },
  plugins: ["expo-secure-store"],
  extra: { releaseStage: process.env.APP_VARIANT ?? "development" },
});
