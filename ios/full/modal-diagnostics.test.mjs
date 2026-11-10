import test from 'node:test';
import assert from 'node:assert/strict';
import { modalWarningSummary, recentModalWarnings } from './modal-diagnostics.ts';

test('UIKit诊断只保存固定类别和合法时间，不输出对象、进程、路径或用户数据', () => {
  const event = { timestamp: '2026-11-10 04:22:58.000000+0000',
    eventMessage: 'private-controller already presenting private-user', processImagePath: 'private-path' };
  const result = modalWarningSummary([
    'not-json-private', JSON.stringify({ eventMessage: 'private-text' }),
    ...Array.from({ length: 20 }, () => JSON.stringify(event)),
    JSON.stringify({ ...event, timestamp: 'private-timestamp' }),
  ].join('\n'));
  assert.equal(result.length, 16);
  assert.deepEqual(result[0], { category: 'already presenting', timestamp: event.timestamp });
  assert.equal(result.at(-1).timestamp, undefined);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('读取限定模拟器近期日志，查询失败继续交由调用者保护原始失败', async () => {
  const failure = new Error('log unavailable');
  await assert.rejects(recentModalWarnings('test-udid', async (command, args, options) => {
    assert.equal(command, 'xcrun');
    assert.deepEqual(args.slice(0, 4), ['simctl', 'spawn', 'test-udid', 'log']);
    assert.ok(options.timeout <= 10_000);
    throw failure;
  }), error => error === failure);
});
