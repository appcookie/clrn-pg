import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { captureNativeTransition, middleCandidates } from './animation-transition.ts';

const size = { width: 120, height: 180 };
const region = { x: 25, y: 0, width: 95, height: 180 };
const node = (res, bounds) => ({ res, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
const panelNodes = [node(undefined, region),
  node('review-board-description-text', { x: 35, y: 80, width: 75, height: 10 }),
  node('review-board-slider', { x: 35, y: 140, width: 60, height: 10 }),
  node('review-board-share-button', { x: 100, y: 140, width: 10, height: 10 })];

// A patterned table remains spatially identical when the dimmer appears.
// The entering sidebar changes its layout and introduces its own controls.
function picture(panelLeft, dimmer = false) {
  const png = new PNG(size);
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    let rgb = [(x % 12) * 3 + 35, (y % 18) * 3 + 120, 80];
    if (dimmer) rgb = rgb.map(value => Math.round(value * .55));
    if (panelLeft !== undefined && x >= panelLeft) {
      rgb = y > 140 || (y > 75 && y < 85) ? [180, 180, 190] : [25, 25, 40];
    }
    png.data.set([...rgb, 255], (y * size.width + x) * 4);
  }
  return PNG.sync.write(png);
}

test('两种牌谱入场都拒绝只有遮罩的假中间帧，真实侧栏滑入仍可通过', async () => {
  const before = picture(), dimmer = picture(undefined, true);
  const sliding = picture(70, true), after = picture(25, true);
  assert.equal(middleCandidates(before, after, [before, dimmer, after], 'videoFrames').length, 1,
    '反例必须证明原像素距离门禁会接受遮罩帧');
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  try {
    for (const game of ['texas-holdem', 'zhajinhua']) {
      const run = async frames => {
        let nodeCalls = 0, screenshotCalls = 0;
        let tapCount = 0, readyCalled = false, recording = false;
        const attachments = new Map();
        const device = { screenSize: size, nodes: async () => {
          assert.equal(recording, false, '侧栏绘制窗口不能并行查询整棵可见树');
          return nodeCalls++ ? panelNodes : [];
        },
          nativeScreenshot: async () => screenshotCalls++ ? after : before };
        await captureNativeTransition(device, `${game}-game-record-enter`,
          { attach: async (name, value) => attachments.set(name, value) }, region,
          () => { tapCount++; }, [], [], 0, 'videoFrames', undefined,
          async () => {
            readyCalled = true;
            assert.equal(recording, false, '业务就绪在完整录屏结束后验证');
            assert.equal(nodeCalls, 1, '语义就绪必须先于完整终点树');
            assert.equal(screenshotCalls, 1, '语义就绪必须先于终点截图');
          }, [], [], [], [], [],
          async (_device, _name, _region, trigger, _info, durationMs) => {
            recording = true;
            await trigger();
            assert.equal(durationMs, 3500, '保留完整3.5秒录屏窗口');
            assert.equal(readyCalled, false, '录屏窗口内不发就绪查询');
            recording = false;
            return frames;
          });
        assert.equal(tapCount, 1, '不通过重复点击重采缺失相位');
        return attachments;
      };
      await assert.rejects(run([before, before, after]), /牌桌遮罩变暗不能冒充/);
      await assert.rejects(run([before, dimmer, after]), /牌桌遮罩变暗不能冒充/);
      const attachments = await run([before, dimmer, sliding, after]);
      const middle = JSON.parse(attachments.get(`${game}-game-record-enter-middle-progress`).body);
      assert.equal(middle.index, 2, '实际选中的中间帧必须包含滑入侧栏');
      const timings = JSON.parse(attachments.get(`${game}-game-record-enter-endpoint-timing`).body);
      assert.deepEqual(timings.map(item => item.phase),
        ['recorder-returned', 'ready-start', 'ready-complete', 'nodes-start', 'nodes-complete', 'screenshot-complete']);
      assert.ok(timings.every(item => Number.isFinite(Date.parse(item.utc))));
      assert.ok(timings.every((item, index) => !index || item.elapsedMs >= timings[index - 1].elapsedMs));
    }
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
});

test('牌谱与个人排行榜录后就绪失败保留UTC诊断且不读取终点；其他动作仍在录屏中验证就绪', async () => {
  for (const name of ['texas-holdem-game-record-enter', 'zhajinhua-game-record-enter',
    'texas-holdem-personal-leaderboard-enter', 'texas-holdem-personal-leaderboard-exit',
    'zhajinhua-game-record-exit', 'zhajinhua-settings-enter']) {
    const deferred = name.endsWith('game-record-enter') || name === 'texas-holdem-personal-leaderboard-enter';
    const attachments = new Map();
    let recording = false, nodeCalls = 0, screenshotCalls = 0, taps = 0;
    const failure = new Error('native readiness failed');
    await assert.rejects(captureNativeTransition({ screenSize: size,
      nodes: async () => { nodeCalls++; return []; },
      nativeScreenshot: async () => { screenshotCalls++; return picture(); } }, name,
    { attach: async (key, value) => attachments.set(key, value) }, region,
    () => { taps++; }, [], [], 0, 'videoFrames', undefined,
    async () => {
      assert.equal(recording, !deferred);
      throw failure;
    }, [], [], [], [], [], async (_device, _name, _region, trigger) => {
      recording = true;
      try { await trigger(); return [picture(), picture(), picture(25, true)]; }
      finally { recording = false; }
    }), error => error === failure);
    assert.equal(taps, 1);
    assert.equal(nodeCalls, 1);
    assert.equal(screenshotCalls, 1);
    if (deferred) {
      const timing = JSON.parse(attachments.get(`${name}-endpoint-timing`).body);
      assert.deepEqual(timing.map(item => item.phase), ['recorder-returned', 'ready-start', 'ready-failed']);
      assert.ok(timing.every(item => Number.isFinite(Date.parse(item.utc))));
    }
  }
});
