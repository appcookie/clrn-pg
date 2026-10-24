import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { nativePregamePanelBounds, buyInTargetMotionBounds } from './pregame-panel-region.ts';
import { nativeTargetMotionEvidence, captureNativeTransition, middleCandidates } from './animation-transition.ts';
const node = (res, bounds) => ({ res, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
const screen = { width: 1178, height: 2556 };

test('主题和续费必须包含右侧关闭按钮、两侧内容及最底部控件', () => {
  const theme = [node(undefined, { x: 77, y: 723, width: 1024, height: 1110 }),
    node('game-settings-close-button', { x: 1001, y: 729, width: 100, height: 96 }),
    ...['simple', 'realistic', 'four-color', 'four-color-two'].map((name, index) =>
      node(`game-settings-card-theme-${name}`, { x: index % 2 ? 629 : 185,
        y: index < 2 ? 864 : 1095, width: 367, height: 204 })),
    ...['green', 'blue', 'purple', 'black'].map((name, index) =>
      node(`game-settings-background-${name}`, { x: 170 + index * 234, y: 1500, width: 139, height: 240 }))];
  assert.deepEqual(nativePregamePanelBounds('theme', theme, screen), { x: 73, y: 719, width: 1032, height: 1118 });
  assert.throws(() => nativePregamePanelBounds('theme', theme.slice(1), screen), /完整原生容器/);
  assert.throws(() => nativePregamePanelBounds('theme', theme.slice(0, -1), screen), /background-black/);
  const renew = [node(undefined, { x: 62, y: 798, width: 1054, height: 960 }),
    node('renew-popup-close-button', { x: 1046, y: 828, width: 40, height: 36 }),
    node('renew-popup-slider', { x: 167, y: 1293, width: 844, height: 123 }),
    node('renew-popup-cancel-button', { x: 239, y: 1572, width: 223, height: 102 }),
    node('renew-popup-confirm-button', { x: 719, y: 1572, width: 223, height: 102 }),
    node('renew-popup-remain-diamond', { x: 695, y: 1134, width: 115, height: 54 }),
    node('renew-popup-spend-diamond', { x: 716, y: 1188, width: 52, height: 54 })];
  assert.deepEqual(nativePregamePanelBounds('renew', renew, screen), { x: 58, y: 794, width: 1062, height: 968 });
  assert.throws(() => nativePregamePanelBounds('renew', [node(undefined, { x: 0, y: 0, ...screen }), ...renew.slice(1)], screen), /完整原生容器/);
});

test('买入目标运动区域必须避开起点整个菜单，缺失原生菜单不能猜测', () => {
  const menu = [node('drawer-menu-item-buy_in', { x: 0, y: 663, width: 492, height: 135 }),
    node('drawer-menu-item-exit', { x: 0, y: 1194, width: 492, height: 135 })];
  assert.deepEqual(buyInTargetMotionBounds({ x: 118, y: 809, width: 942, height: 938 }, menu),
    { x: 496, y: 809, width: 564, height: 938 });
  assert.throws(() => buyInTargetMotionBounds({ x: 118, y: 809, width: 942, height: 938 }, []), /真实原生菜单/);
});

test('真实原生录像的菜单/遮罩帧不能冒充买入中间帧（run 39527425854，frame 166）', async () => {
  const read = name => readFileSync(new URL(`./fixtures/buy-in-menu-only/${name}.png`, import.meta.url));
  const before = read('start'), after = read('end'), menuOnly = read('menu-dimmer-only');
  assert.equal(middleCandidates(before, after, [before, menuOnly, after], 'videoFrames').length, 1);
  const actual = await nativeTargetMotionEvidence(before, after, [before, menuOnly, after]);
  assert.equal(actual.localMotionCandidates.length, 1);
  assert.ok(actual.localMotionCandidates[0].localMotion < actual.minimumLocalMotion);
  assert.equal(actual.candidates.length, 0);
});

test('菜单消失后静态跳出买入框不能通过；必须采到买入框本身缩放', async () => {
  const size = { width: 120, height: 180 };
  const picture = (menu, panel) => {
    const png = new PNG(size);
    for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
      const inMenu = menu && x < 48 && y < 130;
      const inPanel = panel && x >= panel.x && x < panel.x + panel.width
        && y >= panel.y && y < panel.y + panel.height;
      png.data.set(inPanel ? [20, 20, 60, 255] : inMenu ? [25, 25, 25, 255] : [20, 160, 100, 255],
        (y * size.width + x) * 4);
    }
    return PNG.sync.write(png);
  };
  const panel = { x: 20, y: 40, width: 80, height: 100 };
  const before = picture(true), menuGone = picture(false), after = picture(false, panel);
  const dimmed = PNG.sync.read(menuGone);
  for (let offset = 0; offset < dimmed.data.length; offset += 4)
    for (let channel = 0; channel < 3; channel++) dimmed.data[offset + channel] = Math.round(dimmed.data[offset + channel] * .8);
  const dimmerOnly = PNG.sync.write(dimmed);
  const zoom = picture(false, { x: 35, y: 60, width: 50, height: 60 });
  assert.ok(middleCandidates(before, after, [before, menuGone, after], 'videoFrames').length > 0,
    '回归样例必须复现全图距离会误认菜单退场');
  const menuNodes = [node('drawer-menu-item-buy_in', { x: 0, y: 40, width: 48, height: 40 }),
    node('drawer-menu-item-exit', { x: 0, y: 90, width: 48, height: 40 })];
  const panelNodes = [node(undefined, panel), node('buy-in-title', { x: 35, y: 55, width: 50, height: 10 }),
    node('buy-in-close-button', { x: 90, y: 40, width: 10, height: 10 }),
    node('buy-in-confirm-button', { x: 35, y: 120, width: 50, height: 10 })];
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const run = frames => {
    let nodeCalls = 0, screenshotCalls = 0;
    const device = { screenSize: size, nodes: async () => nodeCalls++ ? panelNodes : menuNodes,
      nativeScreenshot: async () => screenshotCalls++ ? after : before };
    return captureNativeTransition(device, 'texas-holdem-buy_in-enter', { attach: async () => {} }, panel,
      () => {}, [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [], [],
      async (_device, _name, _region, trigger) => { await trigger(); return frames; });
  };
  try {
    await assert.rejects(run([before, menuGone, after]), /菜单退场不能冒充/);
    await assert.rejects(run([before, dimmerOnly, after]), /菜单退场不能冒充/);
    await run([before, menuGone, zoom, after]);
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
});
