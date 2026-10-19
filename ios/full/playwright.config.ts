import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const artifactPath = (name: string) => fileURLToPath(new URL(`../artifacts/${name}`, import.meta.url));
export default defineConfig({
  testDir: '.', testMatch: ['tests/**/*.spec.ts', 'functional/**/*.spec.ts'],
  timeout: 180_000, expect: { timeout: 30_000 }, workers: 1, fullyParallel: false, retries: 0,
  // 保留最多三个独立失败的证据，同时限制失败后的 Simulator 重启成本。
  maxFailures: process.env.CI ? 3 : undefined,
  forbidOnly: !!process.env.CI,
  outputDir: artifactPath('full-results'),
  reporter: [['list'], ['html', { outputFolder: artifactPath('full-report'), open: 'never' }],
    ['json', { outputFile: artifactPath('full-results/report.json') }]],
  snapshotPathTemplate: `{testDir}/../snapshots/full/iphone16-ios18.5-${process.env.IOS_LOCALE || 'en'}/{arg}{ext}`,
  use: { trace: 'off' },
});
