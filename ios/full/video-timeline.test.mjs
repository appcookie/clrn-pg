import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecordedTimeline } from './video-timeline.ts';

function frames(durationMs, fps = 30) {
  return Array.from({length: Math.floor(durationMs * fps / 1000) + 1}, (_, index) => ({
    best_effort_timestamp_time: String(index / fps),
  }));
}

test('媒体时长与墙钟时长分开记录，不能相减推断动作前覆盖', () => {
  const result = validateRecordedTimeline(frames(2050), 4000);
  assert.equal(result.postTriggerWallMs, 4000);
  assert.ok(result.durationMs < result.postTriggerWallMs);
  assert.equal('preTriggerMs' in result, false);
});

test('保留编码时戳，变帧率不能伪装成固定30fps', () => {
  const input = frames(6000, 24);
  const result = validateRecordedTimeline(input, 3500);
  assert.equal(result.durationMs, 6000);
  assert.equal(result.timestampsMs.length, input.length);
  assert.equal(result.timestampsMs[1], 1000 / 24);
  assert.equal(result.timestampsMs.at(-1), 6000);
});

test('时戳缺失、倒序和重复帧时戳均不能通过真实视频覆盖校验', () => {
  for (const change of [undefined, 'NaN', '0', '-1']) {
    const input = frames(6000);
    input[12].best_effort_timestamp_time = change;
    assert.throws(() => validateRecordedTimeline(input, 3500), /真实连续帧或有效时戳/);
  }
  assert.throws(() => validateRecordedTimeline(frames(500), 0), /真实连续帧/);
  assert.throws(() => validateRecordedTimeline(frames(6000), NaN), /有效的非负毫秒数/);
});
