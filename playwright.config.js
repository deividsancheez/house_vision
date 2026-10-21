// End-to-end tests run against the production build (npm run build + vite preview), on a desktop
// browser and on a phone-sized touch screen.
import { defineConfig } from '@playwright/test';

const gpu = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
// the frame-rate run (npm run test:perf) keeps its own results file so it doesn't replace the main one
const perfRun = process.argv.includes('@perf') && !process.argv.includes('--grep-invert');
const tag = perfRun ? '-perf' : '';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/artifacts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [['list'], ['json', { outputFile: `test-results/results${tag}.json` }], ['html', { outputFolder: `test-results/html${tag}`, open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173/',
    launchOptions: { args: gpu },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    // a mid-range Android phone: 412 x 892 CSS px, touch only
    { name: 'phone', testIgnore: /lookbook.spec/, use: { browserName: 'chromium', viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    // the lookbook is also checked on a 390 px phone (iPhone 12-15 width)
    { name: 'phone-390', testMatch: /lookbook.spec/, use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 600_000,
  },
});
