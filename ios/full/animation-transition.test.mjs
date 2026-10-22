import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { assertReviewedVideoMiddle, frameColorDistance, middleCandidates, reviewedLauncherStart,
  reviewedVideoMiddleEvidence, transitionEvidence } from './animation-transition.ts';

function picture(top) {
  const png = new PNG({ width: 120, height: 180 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const inside = x >= 30 && x < 100 && y >= top && y < top + 80;
    const offset = (y * png.width + x) * 4;
    png.data.set(inside ? [220, 30 + x, 30 + y % 40, 255] : [20, 30, 60, 255], offset);
  }
  return PNG.sync.write(png);
}
const before = picture(180), middle = picture(100), after = picture(30);

test('单次解码与原始逐对比较得到完全一致的距离、帧序号和候选结果', () => {
  const frames = Array.from({ length: 16 }, (_, i) => picture(180 - i * 10));
  for (const method of ['videoFrames', 'motionFrames', 'launchFrames']) {
    const total = frameColorDistance(before, after), minimum = method === 'videoFrames' ? Math.min(7, total * .2) : 1;
    const previous = frames.map((frame, index) => ({ frame, index,
      progress: frameColorDistance(before, frame) / total, remaining: frameColorDistance(after, frame) / total }));
    const expected = previous.filter(item => item.progress > .02 && item.remaining > .02
      && frameColorDistance(before, item.frame) > minimum && frameColorDistance(after, item.frame) > minimum);
    const actual = transitionEvidence(before, after, frames, method);
    assert.equal(actual.total, total);
    assert.deepEqual(actual.progress, previous.map(item => item.progress));
    assert.deepEqual(actual.candidates, expected);
  }
});

test('滑入轨迹必须包含区别于起点和终点的真实中途画面', () => {
  assert.equal(middleCandidates(before, after, [before, before, after], 'videoFrames').length, 0);
  const candidates = middleCandidates(before, after, [before, middle, after], 'videoFrames');
  assert.equal(candidates.length, 1);
  assertReviewedVideoMiddle(before, after, candidates, [middle]);
});

test('纯色闪屏即使改变像素也不能冒充已审查的局部滑入', () => {
  const png = PNG.sync.read(before);
  for (let i = 0; i < png.data.length; i += 4) for (let channel = 0; channel < 3; channel++) png.data[i + channel] += 30;
  const flash = PNG.sync.write(png);
  assert.throws(() => assertReviewedVideoMiddle(before, after,
    middleCandidates(before, after, [before, flash, after], 'videoFrames'), [middle]), /动画中途帧/);
});

test('接近起止点的采样必须失败并明确原因，不能用 Infinity 或自动重试掩盖缺失相位', () => {
  const valid = middleCandidates(before, after, [before, middle, after], 'videoFrames')[0];
  for (const [field, reason] of [['progress', 'too-close-to-start'], ['remaining', 'too-close-to-end']]) {
    const candidate = { ...valid, [field]: 0.01 };
    const evidence = reviewedVideoMiddleEvidence(before, after, [candidate], [middle]);
    assert.ok(evidence.matches[0].rejected.includes(reason));
    assert.equal(evidence.matches[0].distance, 0);
    assert.throws(() => assertReviewedVideoMiddle(before, after, [candidate], [middle]), new RegExp(reason));
  }
  const evidence = reviewedVideoMiddleEvidence(before, after, [valid], [middle]);
  assert.deepEqual(evidence.matches[0].rejected, []);
});

test('不同分辨率动画不能通过缩放后忽略尺寸变化', () => {
  assert.throws(() => frameColorDistance(before, PNG.sync.write(new PNG({ width: 60, height: 90 }))), /尺寸变化/);
});

test('启动器壁纸与 Maps 加载可变化，三个静态图标错位不能通过', () => {
  const reviewed = readFileSync('ios/snapshots/v1/launch/launch/native-launch-and-staging-notice/ios/iphone16-ios18.5/en/animation/start.png');
  const tinted = PNG.sync.read(reviewed);
  for (let y = 0; y < tinted.height; y++) for (let x = 0; x < tinted.width; x++) {
    if (x >= 370 && x < 530 && y >= 850 && y < 1000) continue;
    if (x >= 650 && x < 810 && y >= 840 && y < 1000) continue;
    if (x >= 370 && x < 530 && y >= 2290 && y < 2460) continue;
    const offset = (y * tinted.width + x) * 4;
    tinted.data[offset] = 150;
    tinted.data[offset + 1] = 80;
    tinted.data[offset + 2] = 40;
  }
  const validTint = PNG.sync.write(tinted);
  assert.equal(reviewedLauncherStart(validTint, reviewed), true);
  for (const [x, y] of [[390, 870], [670, 860], [390, 2310]]) {
    const wrongIcon = PNG.sync.read(validTint);
    for (let row = y; row < y + 120; row++) for (let column = x; column < x + 120; column++) {
      const offset = (row * wrongIcon.width + column) * 4;
      wrongIcon.data.set([0, 0, 0, 255], offset);
    }
    assert.equal(reviewedLauncherStart(PNG.sync.write(wrongIcon), reviewed), false);
  }
});

test('smoke保留完整转场语义和帧附件，但不读取未知基准', async () => {
  const { captureNativeTransition } = await import('./animation-transition.ts');
  const previousMode = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const attachments = [];
  let screenshots = 0, triggered = false;
  const device = { nodes: async () => [], screenSize: { width: 120, height: 180 }, nativeScreenshot: async () => screenshots++ ? after : before };
  const info = { attach: async (name) => attachments.push(name), snapshotPath: () => { throw new Error('smoke不能读取基准'); } };
  try {
    await captureNativeTransition(device, 'synthetic-slide', info, { x: 0, y: 0, width: 120, height: 180 },
      () => { triggered = true; }, [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [], [],
      async (_device, _name, _region, trigger) => { await trigger(); return [before, middle, after]; });
    assert.equal(triggered, true);
    assert.ok(attachments.includes('synthetic-slide-middle.png'));
    screenshots = 0;
    await assert.rejects(captureNativeTransition(device, 'missed-start', info,
      { x: 0, y: 0, width: 120, height: 180 }, () => {}, [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [], [],
      async (_device, _name, _region, trigger) => { await trigger(); return [after, middle, after]; }), /首帧/);
    await assert.rejects(captureNativeTransition({ ...device, nativeScreenshot: async () => before }, 'frozen', info,
      { x: 0, y: 0, width: 120, height: 180 }, () => {}, [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [], [],
      async (_device, _name, _region, trigger) => { await trigger(); return [before, before, before]; }), /可见变化/);
  } finally {
    if (previousMode === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previousMode;
  }
});

test('异步面板就绪发生在录像停止前，检查帧与终点截图发生在停止后', async () => {
  const { captureNativeTransition } = await import('./animation-transition.ts');
  const previousMode = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const events = [];
  let screenshots = 0;
  const device = { nodes: async () => [], screenSize: { width: 120, height: 180 }, nativeScreenshot: async () => {
    events.push(screenshots ? 'end-screenshot' : 'start-screenshot');
    return screenshots++ ? after : before;
  } };
  const info = { attach: async () => {}, snapshotPath: () => { throw new Error('smoke不能读取基准'); } };
  try {
    await captureNativeTransition(device, 'async-slide', info, { x: 0, y: 0, width: 120, height: 180 },
      async () => { events.push('trigger'); }, [], [], 1, 'videoFrames',
      async () => { events.push('inspect'); }, async () => { events.push('ready'); }, [], [], [], [], [],
      async (_device, _name, _region, trigger) => {
        events.push('record-start');
        await trigger();
        events.push('stable-tail');
        events.push('record-stop');
        return [before, middle, after];
      }, async () => { events.push('static-layout-check'); });
    assert.deepEqual(events, ['start-screenshot', 'record-start', 'trigger', 'ready', 'stable-tail',
      'record-stop', 'static-layout-check', 'inspect', 'end-screenshot']);
  } finally {
    if (previousMode === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previousMode;
  }
});

test('语音退场在读取缓慢的原生树前保存独立终点截图', async () => {
  const { captureNativeTransition } = await import('./animation-transition.ts');
  const previousMode = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const events = [];
  let screenshots = 0, trees = 0;
  const bounds = (x, y, width, height) => ({ x, y, width, height });
  const panel = [
    { clazz: 'XCUIElementTypeOther', bounds: bounds(0, 1, 120, 179), visible: true },
    ...['in-game-audio-top-tips', 'in-game-audio-microphone-button', 'in-game-audio-bottom-tips']
      .map((res, index) => ({ res, bounds: bounds(35, 25 + index * 55, 50, 20), visible: true })),
  ];
  const device = { screenSize: { width: 120, height: 180 },
    nodes: async () => { events.push(trees ? 'end-tree' : 'start-tree'); return trees++ ? [] : panel; },
    nativeScreenshot: async () => {
      events.push(screenshots ? 'end-screenshot' : 'start-screenshot');
      return screenshots++ ? after : before;
    } };
  const info = { attach: async () => {}, snapshotPath: () => { throw new Error('smoke不能读取基准'); } };
  try {
    await captureNativeTransition(device, 'texas-holdem-voice-exit', info,
      bounds(0, 1, 120, 179), () => { events.push('trigger'); }, [], [], 0, 'videoFrames',
      undefined, undefined, [], [], [], [], [],
      async (_device, _name, _region, trigger, _info, _duration, _minimum, onRecorded) => {
        await trigger();
        events.push('record-stop');
        await onRecorded();
        return [before, middle, after];
      });
    assert.deepEqual(events, ['start-screenshot', 'start-tree', 'trigger', 'record-stop',
      'end-screenshot', 'end-tree']);
  } finally {
    if (previousMode === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previousMode;
  }
});


test('稀疏转场仍必须保留真实中途过程，首尾硬切失败', async () => {
  const { captureNativeTransition } = await import('./animation-transition.ts');
  const { validateRecordedTimeline } = await import('./video-timeline.ts');
  const previousMode = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const info = { attach: async () => {} };
  const run = async frames => {
    let screenshots = 0;
    const device = { nodes: async () => [], screenSize: { width: 120, height: 180 },
      nativeScreenshot: async () => screenshots++ ? after : before };
    return captureNativeTransition(device, 'short-native-slide', info,
      { x: 0, y: 0, width: 120, height: 180 }, () => {}, [], [], 0, 'videoFrames',
      undefined, undefined, [], [], [], [], [], async (_device, _name, _region, trigger, _info, _duration, minimum) => {
        validateRecordedTimeline(frames.map((_, index) => ({ pts_time: String(index / 30) })), 3500, minimum);
        await trigger(); return frames;
      });
  };
  try {
    await run([before, ...Array(12).fill(middle), after]);
    await assert.rejects(run([...Array(7).fill(before), ...Array(7).fill(after)]), /真实动画帧/);
    await assert.rejects(run(Array(14).fill(after)), /首帧/);
    await run([before, middle, after]);
    await assert.rejects(run([before, after]), /真实候选帧/);
  } finally {
    if (previousMode === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previousMode;
  }
});
