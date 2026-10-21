import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { zhajinhuaOperationMarkers, zhajinhuaOperationRegion, zhajinhuaOperationClockMasks,
  zhajinhuaChallengeCancel, readyZhajinhuaChallengeCancel } from './zhajinhua-operation-region.ts';
import { captureNativeTransition } from './animation-transition.ts';
const node = (res, bounds) => ({ res, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
const actualBounds = [
  [206, 1626, 136, 162], [416, 1626, 136, 162], [626, 1626, 136, 162], [836, 1626, 136, 162],
  [491, 1815, 199, 204], [173, 1965, 199, 204], [806, 1965, 199, 204], [962, 2172, 216, 219], [62, 2262, 226, 99],
];
const controls = zhajinhuaOperationMarkers.map((res, index) => {
  const [x, y, width, height] = actualBounds[index];
  return node(res, { x, y, width, height });
});
test('操作入场范围包含全部9个原生按钮，已经显示的起点和缺失按钮必须失败', () => {
  const screen = { width: 1178, height: 2556 };
  assert.deepEqual(zhajinhuaOperationRegion([], controls, screen), { x: 58, y: 1622, width: 1120, height: 773 });
  assert.throws(() => zhajinhuaOperationRegion(controls, controls, screen), /已显示/);
  assert.throws(() => zhajinhuaOperationRegion([], controls.slice(0, -1), screen), /delay-operation/);
});

test('原生倒计时端点遮罩不能覆盖操作按钮', () => {
  const timer = node('zhajinhua-active-countdown', { x: 405, y: 2110, width: 150, height: 150 });
  const player = { ...node('zhajinhua-player-container-self-operating', timer.bounds), children: [timer] };
  assert.deepEqual(zhajinhuaOperationClockMasks([player, ...controls])[0], {
    ...timer.bounds, reason: '仅端点比较排除本人独立倒计时；完整原生录像与按钮中途帧保留',
  });
  assert.throws(() => zhajinhuaOperationClockMasks([player,
    node('zhajinhua-operation-button-fold', timer.bounds)]), /不得覆盖/);
});

test('隐藏操作区、4个挑战目标与取消区域复用同一次完整原生观测，驱动错误直接传播', async () => {
  const targets = Array.from({ length: 4 }, (_, index) => node('challenge_player_selector',
    { x: 20 + index * 30, y: 100, width: 20, height: 20 }));
  const cancel = { ...node('zhajinhua-cancel-challenge-choosing', { x: 0, y: 0, width: 1178, height: 2556 }), enabled: true };
  const prepared = [...targets, cancel];
  let reads = 0;
  assert.equal(await readyZhajinhuaChallengeCancel(async () => { reads++; return prepared; }), cancel);
  assert.equal(reads, 1);
  assert.throws(() => zhajinhuaChallengeCancel([...prepared, controls[0]]), /必须消失/);
  assert.throws(() => zhajinhuaChallengeCancel(prepared.slice(1)), /4个真实/);
  assert.throws(() => zhajinhuaChallengeCancel([...targets, { ...cancel, enabled: false }]), /可点击/);
  reads = 0;
  assert.equal(await readyZhajinhuaChallengeCancel(async () => ++reads === 1 ? targets : prepared, 1000, 0), cancel);
  assert.equal(reads, 2);
  await assert.rejects(readyZhajinhuaChallengeCancel(async () => { throw new Error('native driver disconnected'); }), /native driver disconnected/);
});

test('三大操作按钮必须分别采到真实局部变化，单个按钮硬切或纯遮罩变化不能通过', async () => {
  const size = { width: 360, height: 400 };
  const positions = [[50, 50, 35, 30], [115, 50, 35, 30], [180, 50, 35, 30], [245, 50, 35, 30],
    [150, 140, 50, 50], [50, 220, 50, 50], [250, 220, 50, 50], [320, 300, 35, 35], [20, 300, 35, 30]];
  const nodes = positions.map(([x, y, width, height], index) => node(zhajinhuaOperationMarkers[index], { x, y, width, height }));
  const picture = (phase, hardCut = false) => {
    const png = new PNG(size);
    for (let offset = 0; offset < png.data.length; offset += 4) png.data.set([20, 90, 70, 255], offset);
    if (!phase) return PNG.sync.write(png);
    for (const [index, { bounds }] of nodes.entries()) {
      const factor = phase === 'middle' && !(hardCut && index === 5) ? .6 : 1;
      const width = Math.round(bounds.width * factor), height = Math.round(bounds.height * factor);
      const left = bounds.x + Math.floor((bounds.width - width) / 2), top = bounds.y + Math.floor((bounds.height - height) / 2);
      for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
        const icon = Math.abs(x - left - width / 2) < 3;
        png.data.set(icon ? [240, 240, 240, 255] : [230, 100 + index * 10, 15, 255], (y * size.width + x) * 4);
      }
    }
    return PNG.sync.write(png);
  };
  const before = picture(), after = picture('end');
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const run = middle => {
    let observations = 0, screenshots = 0;
    const device = { screenSize: size, nodes: async () => observations++ ? nodes : [],
      nativeScreenshot: async () => screenshots++ ? after : before };
    return captureNativeTransition(device, 'zhajinhua-operation-buttons', { attach: async () => {} },
      { x: 0, y: 0, ...size }, () => {}, [], [], 0, 'videoFrames', undefined, undefined,
      [], [], [], [], [], async (_device, _name, _region, trigger) => { await trigger(); return [before, middle, after]; });
  };
  try {
    await run(picture('middle'));
    await assert.rejects(run(picture('middle', true)), /fold.*真实局部中间态/);
    const dimmer = PNG.sync.read(before);
    for (let offset = 0; offset < dimmer.data.length; offset += 4)
      for (let channel = 0; channel < 3; channel++) dimmer.data[offset + channel] = Math.round(dimmer.data[offset + channel] * .8);
    await assert.rejects(run(PNG.sync.write(dimmer)), /真实局部中间态/);
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
});
