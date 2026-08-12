import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.remoteagent.mobile",
  appName: "Remote Agent",
  webDir: "dist/client",
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      style: "DARK",
      hidden: false,
    },
  },
  android: {
    allowMixedContent: true,
  },
  ios: {
    preferredContentMode: "mobile",
  },
};

export default config;
