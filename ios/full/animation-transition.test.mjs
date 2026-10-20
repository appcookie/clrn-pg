import assert from 'node:assert/strict';
import test from 'node:test';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { assertReviewedVideoMiddle, frameColorDistance, middleCandidates, reviewedLauncherStart } from './animation-transition.ts';

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

test('不同分辨率动画不能通过缩放后忽略尺寸变化', () => {
  assert.throws(() => frameColorDistance(before, PNG.sync.write(new PNG({ width: 60, height: 90 }))), /尺寸变化/);
});

test('启动器壁纸变色可通过，已审查 Maps 前景错位不能通过', () => {
  const reviewed = readFileSync('ios/snapshots/v1/launch/launch/native-launch-and-staging-notice/ios/iphone16-ios18.5/en/animation/start.png');
  const tinted = PNG.sync.read(reviewed);
  for (let y = 0; y < tinted.height; y++) for (let x = 0; x < tinted.width; x++) {
    if (x >= 120 && x < 510 && y >= 280 && y < 690) continue;
    if (x >= 370 && x < 530 && y >= 850 && y < 1000) continue;
    if (x >= 370 && x < 530 && y >= 2290 && y < 2460) continue;
    const offset = (y * tinted.width + x) * 4;
    tinted.data[offset] = 150;
    tinted.data[offset + 1] = 80;
    tinted.data[offset + 2] = 40;
  }
  const validTint = PNG.sync.write(tinted);
  assert.equal(reviewedLauncherStart(validTint, reviewed), true);
  for (let y = 350; y < 600; y++) for (let x = 180; x < 450; x++) {
    const offset = (y * tinted.width + x) * 4;
    tinted.data.set([0, 0, 0, 255], offset);
  }
  assert.equal(reviewedLauncherStart(PNG.sync.write(tinted), reviewed), false);
  const wrongIcon = PNG.sync.read(validTint);
  for (let y = 870; y < 990; y++) for (let x = 390; x < 510; x++) {
    const offset = (y * wrongIcon.width + x) * 4;
    wrongIcon.data.set([0, 0, 0, 255], offset);
  }
  assert.equal(reviewedLauncherStart(PNG.sync.write(wrongIcon), reviewed), false);
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
      });
    assert.deepEqual(events, ['start-screenshot', 'record-start', 'trigger', 'ready', 'stable-tail',
      'record-stop', 'inspect', 'end-screenshot']);
  } finally {
    if (previousMode === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previousMode;
  }
});
