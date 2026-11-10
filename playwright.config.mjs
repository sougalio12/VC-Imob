import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "line",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "chromium-android", use: { ...devices["Pixel 7"] } },
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } }
  ]
});
