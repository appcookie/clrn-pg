import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCrashSummary } from './native-crash.ts';
test('仅保留目标应用崩溃类型及调用栈，不带环境、寄存器或内存', () => {
  const report = { bundleInfo: { CFBundleIdentifier: 'test.app' }, procName: 'TestApp',
    exception: { type: 'EXC_CRASH', signal: 'SIGABRT' }, termination: { namespace: 'SIGNAL', code: 6 },
    environment: { secret: 'do-not-attach' }, threads: [{ triggered: true, registers: 'do-not-attach',
      frames: [{ imageIndex: 0, imageOffset: 100, symbol: 'abort', extra: 'do-not-attach' }] }],
    usedImages: [{ name: 'TestApp', path: '/private/app', uuid: '123' }] };
  const source = '{}\n' + JSON.stringify(report);
  const summary = nativeCrashSummary(source, 'test.app');
  assert.equal(summary.exception.type, 'EXC_CRASH');
  assert.equal(summary.threads[0].frames[0].symbol, 'abort');
  assert.equal(JSON.stringify(summary).includes('do-not-attach'), false);
  assert.equal(JSON.stringify(summary).includes('/private/app'), false);
  assert.equal(nativeCrashSummary(source, 'other.app'), null);
  assert.equal(nativeCrashSummary(source, undefined), null);
  assert.equal(nativeCrashSummary('invalid', 'test.app'), null);
});
