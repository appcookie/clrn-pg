import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 并发收集不能共用 Playwright 的非原子转换缓存；失败仍直接抛出。 */
export function collectPlaywright(args, options, execute = execFileSync) {
  const cache = mkdtempSync(join(tmpdir(), 'clrn-playwright-collection-'));
  try {
    return execute(process.execPath, ['node_modules/playwright/cli.js', 'test', ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
      ...options,
      env: { ...process.env, ...options?.env, PWTEST_CACHE_DIR: cache },
    });
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}
