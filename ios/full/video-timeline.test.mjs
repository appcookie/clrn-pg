import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecordedTimeline, shortAnimationMinimumFrames } from './video-timeline.ts';

function frames(durationMs, fps = 30) {
  return Array.from({length: Math.floor(durationMs * fps / 1000) + 1}, (_, index) => ({
    pts_time: String(index / fps),
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

test('时戳缺失、倒序和没有时间进展均不能通过真实视频覆盖校验', () => {
  for (const change of [undefined, 'NaN', '0', '-1']) {
    const input = frames(6000);
    input[12].pts_time = change;
    assert.throws(() => validateRecordedTimeline(input, 3500), /真实连续帧或有效时戳/);
  }
  assert.throws(() => validateRecordedTimeline(Array.from({ length: 30 }, () => ({ pts_time: '1' })), 3500), /真实连续帧/);
  assert.throws(() => validateRecordedTimeline(frames(500), 0), /真实连续帧/);
  assert.throws(() => validateRecordedTimeline(frames(6000), NaN), /有效的非负毫秒数/);
  assert.throws(() => validateRecordedTimeline([{ pts_time: '0.000000' }], 4500),
    /"encodedFrames":1,"distinctFrames":1,"minimumDistinctFrames":20/);
});

// Captured simctl encoding: best_effort switches to DTS at the repeated PTS.
test('原始PTS相同的真实编码帧全部保留，不混入best_effort的DTS回退', () => {
  const input = frames(6000);
  input[12] = { pts_time: input[11].pts_time, best_effort_timestamp_time: '0.1' };
  const result = validateRecordedTimeline(input, 3500);
  assert.equal(result.timestampsMs.length, input.length);
  assert.equal(result.timestampsMs[12], result.timestampsMs[11]);
  assert.equal(result.repeatedTimestamps, 1);
  assert.equal(result.timestampSource, 'pts_time');
  assert.equal(result.durationMs, 6000);
});

test('XCTest 原始 MOV 的一个刻度倒退也必须失败，不能排序或修正时间戳', () => {
  // Original MOV from CI 39528661625, frames 120..134. This backwards
  // presentation time already exists before the lossless MP4 remux.
  const input = [2.781667, 2.783333, 2.786667, 2.786667, 2.788333,
    2.790000, 2.793333, 2.791667, 2.793333, 2.795000,
    2.803333, 2.805000, 2.811667, 2.813333, 2.820000]
    .map(time => ({ pts_time: String(time) }));
  assert.throws(() => validateRecordedTimeline(input, 3500, shortAnimationMinimumFrames),
    /"invalidIndex":7/);
});

test('静态启动页可接受真实低帧率录屏，动画仍保持默认20帧门槛', () => {
  const lowRate = frames(16000, 1);
  assert.throws(() => validateRecordedTimeline(lowRate, 14000), /真实连续帧/);
  assert.equal(validateRecordedTimeline(lowRate, 14000, 12).timestampsMs.length, 17);
  assert.throws(() => validateRecordedTimeline(lowRate.slice(0, 11), 14000, 12), /真实连续帧/);
});


test('真实300ms转场的14帧变帧率时间线按短动画契约保留，不能补帧或复用时间戳', () => {
  const input = [0, 5.395, 5.436667, 5.505, 5.551667, 5.596667, 5.733333,
    5.776667, 5.78, 5.798333, 5.8, 5.801667, 6.811667, 6.91].map(time => ({ pts_time: String(time) }));
  const result = validateRecordedTimeline(input, 3500, shortAnimationMinimumFrames);
  assert.deepEqual(result.timestampsMs, input.map(frame => Number(frame.pts_time) * 1000));
  assert.equal(result.timestampsMs.length, 14);
  assert.throws(() => validateRecordedTimeline(input.slice(0, 9), 3500, shortAnimationMinimumFrames), /真实连续帧/);
  assert.throws(() => validateRecordedTimeline(input.map(() => input[0]), 3500, shortAnimationMinimumFrames), /真实连续帧/);
});

test('牌型退场原始 XCTest MOV 的单刻度 PTS 倒退不会因 DTS 单调而通过', () => {
  // CI 39555894478 原始 MOV 与无损 MP4 的帧 300..312 相同；不能用 DTS 替换 PTS。
  const input = [7.365000, 7.366667, 7.370000, 7.370000, 7.371667,
    7.373333, 7.376667, 7.375000, 7.381667, 7.393333,
    7.405000, 7.418333, 7.430000].map(time => ({ pts_time: time.toFixed(6) }));
  input[6].pkt_dts_time = '7.225000';
  input[7].pkt_dts_time = '7.236667';
  const original = structuredClone(input);
  assert.throws(() => validateRecordedTimeline(input, 3500, shortAnimationMinimumFrames),
    /"invalidIndex":7/);
  assert.deepEqual(input, original);
});
