import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 30_000,
  expect: {timeout: 8_000},
  reporter: [['list'], ['html', {outputFolder:'playwright-report',open:'never'}], ['junit', {outputFile:'test-results/e2e.xml'}]],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: 'http://127.0.0.1:4176',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {name:'chromium',use:{...devices['Desktop Chrome']}},
    {name:'chromium-mobile',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}}
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {NODE_ENV:'test',VC_IMOB_TEST_RUN:'1',TZ:'America/Cuiaba'}
  }
});
