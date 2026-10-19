import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectPlaywright } from './playwright-collection.mjs';

test('重叠收集使用不同缓存并保留命令及环境，完成后清理且不更改父进程环境', () => {
  const original = process.env.PWTEST_CACHE_DIR;
  const caches = [];
  const args = ['--list', '--shard', '1/5'];
  const result = collectPlaywright(args, { env: { IOS_GROUP: 'functional', PWTEST_CACHE_DIR: '/shared-cache' } },
    (command, actualArgs, options) => {
      assert.equal(command, process.execPath);
      assert.deepEqual(actualArgs, ['node_modules/playwright/cli.js', 'test', ...args]);
      assert.equal(options.env.IOS_GROUP, 'functional');
      const outer = options.env.PWTEST_CACHE_DIR;
      caches.push(outer);
      assert.notEqual(outer, '/shared-cache');
      assert.ok(existsSync(outer));
      writeFileSync(join(outer, 'compiled.js'), 'export const value = 1;');
      collectPlaywright(['--list'], {}, (_, __, innerOptions) => {
        const inner = innerOptions.env.PWTEST_CACHE_DIR;
        caches.push(inner);
        assert.notEqual(inner, outer);
        assert.ok(existsSync(outer));
        assert.ok(existsSync(inner));
        return '';
      });
      assert.ok(existsSync(outer));
      assert.ok(!existsSync(caches[1]));
      return 'collected';
    });
  assert.equal(result, 'collected');
  assert.ok(caches.every(cache => !existsSync(cache)));
  assert.equal(process.env.PWTEST_CACHE_DIR, original);
});

test('收集失败不重试、不吞错，仍清理独立缓存', () => {
  const failure = new Error('real collection failure');
  let calls = 0;
  let cache;
  assert.throws(() => collectPlaywright(['--list'], {}, (_, __, options) => {
    calls++;
    cache = options.env.PWTEST_CACHE_DIR;
    writeFileSync(join(cache, 'partial.js'), '');
    throw failure;
  }), error => error === failure);
  assert.equal(calls, 1);
  assert.ok(!existsSync(cache));
});
