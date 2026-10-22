import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRecordedTimeline, semanticTransitionMinimumFrames, shortAnimationMinimumFrames } from './video-timeline.ts';

const frames = (durationMs, fps = 30) => Array.from({ length: Math.floor(durationMs * fps / 1000) + 1 },
  (_, index) => ({ pts_time: String(index / fps) }));

test('本轮排行榜437个原始PTS只排除11个非递增候选，原始帧序仍可追溯', () => {
  const input = JSON.parse(readFileSync(new URL('./fixtures/video-timeline/leaderboard-39616432083.json', import.meta.url))).frames;
  const result = validateRecordedTimeline(input, 3500);
  assert.equal(input.length, 437);
  assert.equal(result.frameIndices.length, 426);
  assert.equal(result.backwardsTimestamps, 3);
  assert.deepEqual(result.omittedFrameIndices, [88, 90, 96, 114, 117, 119, 120, 121, 123, 127, 172]);
  assert.deepEqual(result.originalTimestampsMs, input.map(frame => Number(frame.pts_time) * 1000));
  result.frameIndices.forEach((index, position) => {
    assert.equal(result.timestampsMs[position], result.originalTimestampsMs[index] - result.originalTimestampsMs[0]);
    if (position) assert.ok(index > result.frameIndices[position - 1] && result.timestampsMs[position] > result.timestampsMs[position - 1]);
  });
});

test('媒体时长与墙钟时长分开，不能用墙钟推断动作覆盖', () => {
  const result = validateRecordedTimeline(frames(2050), 4000);
  assert.ok(result.durationMs < result.postTriggerWallMs);
  assert.equal('preTriggerMs' in result, false);
});
test('变帧率保留原始时间、帧序和字节索引，不伪装成30fps', () => {
  const input = frames(6000, 24), original = structuredClone(input);
  const result = validateRecordedTimeline(input, 3500);
  assert.deepEqual(result.frameIndices, input.map((_, index) => index));
  assert.deepEqual(result.timestampsMs, input.map(frame => Number(frame.pts_time) * 1000));
  assert.deepEqual(result.omittedFrameIndices, []);
  assert.deepEqual(input, original);
});
test('缺失时戳、静止时间、全倒序或不足候选帧仍失败', () => {
  for (const change of [undefined, null, '', ' ', 'NaN']) {
    const input = frames(6000); input[12].pts_time = change;
    assert.throws(() => validateRecordedTimeline(input, 3500), /有效时戳/);
  }
  for (const input of [Array.from({ length: 30 }, () => ({ pts_time: '1' })), frames(6000).reverse(), frames(500)])
    assert.throws(() => validateRecordedTimeline(input, 3500), /真实候选帧/);
  assert.throws(() => validateRecordedTimeline(frames(6000), NaN), /有效的非负毫秒数/);
  assert.throws(() => validateRecordedTimeline(frames(6000), 1, 1), /至少为 2/);
});
test('重复PTS只选第一个原始帧，不使用best_effort或DTS替换时间', () => {
  const input = frames(6000); input[12] = { pts_time: input[11].pts_time, best_effort_timestamp_time: '0.1' };
  const result = validateRecordedTimeline(input, 3500);
  assert.equal(result.timestampsMs.length, input.length - 1);
  assert.deepEqual(result.omittedFrameIndices, [12]);
  assert.equal(result.frameIndices[12], 13);
  assert.equal(result.repeatedTimestamps, 1);
  assert.equal(result.timestampSource, 'pts_time');
});
for (const [name, times, omitted] of [
  ['排行榜原始MOV', [2.781667, 2.783333, 2.786667, 2.786667, 2.788333, 2.790000, 2.793333, 2.791667, 2.793333, 2.795000, 2.803333, 2.805000, 2.811667, 2.813333, 2.820000], [3, 7, 8]],
  ['牌型退场原始MOV', [7.365000, 7.366667, 7.370000, 7.370000, 7.371667, 7.373333, 7.376667, 7.375000, 7.381667, 7.393333, 7.405000, 7.418333, 7.430000], [3, 7]],
]) test(`${name}保留异常原片，只选原始帧序和PTS都递增的真实候选`, () => {
  const input = times.map(time => ({ pts_time: time.toFixed(6), pkt_dts_time: '0' })), original = structuredClone(input);
  const result = validateRecordedTimeline(input, 3500, shortAnimationMinimumFrames);
  assert.deepEqual(input, original);
  assert.deepEqual(result.omittedFrameIndices, omitted);
  assert.equal(result.backwardsTimestamps, 1);
  result.frameIndices.forEach((index, position) => {
    assert.equal(result.timestampsMs[position], Number(input[index].pts_time) * 1000 - Number(input[0].pts_time) * 1000);
    if (position) { assert.ok(index > result.frameIndices[position - 1]); assert.ok(result.timestampsMs[position] > result.timestampsMs[position - 1]); }
  });
});
test('局部回退之后必须越过此前已选时间，不能把持续倒退排列成假进度', () => {
  const input = [0, 1, 0.9, 0.95, 1, 1.1, 1.2].map(time => ({ pts_time: String(time) }));
  const result = validateRecordedTimeline(input, 0, 3);
  assert.deepEqual(result.frameIndices, [0, 1, 5, 6]);
  assert.deepEqual(result.timestampsMs, [0, 1000, 1100, 1200]);
});
test('真实低帧率和短动画继续要求足够的候选，不补帧或重复计时', () => {
  const low = frames(16000, 1);
  assert.throws(() => validateRecordedTimeline(low, 14000), /真实候选帧/);
  assert.equal(validateRecordedTimeline(low, 14000, 12).timestampsMs.length, 17);
  const input = [0, 5.395, 5.436667, 5.505, 5.551667, 5.596667, 5.733333, 5.776667, 5.78, 5.798333, 5.8, 5.801667, 6.811667, 6.91].map(time => ({ pts_time: String(time) }));
  assert.equal(validateRecordedTimeline(input, 3500, shortAnimationMinimumFrames).timestampsMs.length, 14);
  assert.throws(() => validateRecordedTimeline(input.slice(0, 9), 3500, shortAnimationMinimumFrames), /真实候选帧/);
});
test('稀疏的真实弹窗转场保留八张原片帧，由后续起点、中间帧、终点检查判断画面', () => {
  const input = [0, 4.416667, 4.468333, 4.511667, 4.563333, 4.57, 4.575, 6.908333]
    .map(time => ({ pts_time: time.toFixed(6) }));
  const result = validateRecordedTimeline(input, 3500, semanticTransitionMinimumFrames);
  assert.deepEqual(result.frameIndices, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.durationMs, 6908.333);
  assert.throws(() => validateRecordedTimeline(input.slice(0, 2), 3500, semanticTransitionMinimumFrames), /真实候选帧/);
});
