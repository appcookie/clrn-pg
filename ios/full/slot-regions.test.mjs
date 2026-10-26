import test from 'node:test';
import assert from 'node:assert/strict';
import { slotBannerSpinPoint, slotReelRegions, slotNoEnergyRegions } from './slot-regions.ts';
import { animationRegion } from './animation-region.ts';

test('大厅老虎机入口落在已审查的旋转按钮内并避开滚动画面', () => {
  const banner = { x: 32, y: 537, width: 1114, height: 267 };
  const point = slotBannerSpinPoint(banner);
  assert.deepEqual(point, { x: 834, y: 724 });
  assert.ok(point.y > banner.y + banner.height * 0.64, '点击位置应低于横幅滚轮的运动区域');
  assert.throws(() => slotBannerSpinPoint({ ...banner, width: 0 }), /有效的原生边界/);
});

test('能量不足提示采用真实原生内容与关闭按钮范围，动画左边框不包含随机滚轮', () => {
  const node = (res, bounds, text) => ({ res, bounds, text, clazz: 'XCUIElementTypeOther', children: [] });
  const screenSize = { width: 1178, height: 2556 };
  const nodes = [
    node(undefined, { x: 0, y: 0, ...screenSize }),
    node(undefined, { x: 137, y: 828, width: 904, height: 903 }),
    node('close-button', { x: 947, y: 768, width: 154, height: 150 }),
    node('assets/slot-machine/page/screen/image/img_out_of_spins@3x.png', { x: 302, y: 984, width: 574, height: 363 }),
    node('confirm-button', { x: 362, y: 1539, width: 454, height: 153 }, 'Confirm'),
    node('Out of Spins?', { x: 416, y: 864, width: 349, height: 69 }, 'Out of Spins?'),
  ];
  const regions = slotNoEnergyRegions(nodes, screenSize);
  assert.deepEqual(regions.full, { x: 133, y: 764, width: 972, height: 971 });
  assert.deepEqual(regions.border, { x: 137, y: 828, width: 82, height: 903 });
  assert.ok(regions.border.x + regions.border.width < 281, '第一列随机图案从真实 x=281 开始');
  const enter = animationRegion('slot-no-energy-enter', [], nodes, { screenSize }, screenSize);
  assert.deepEqual(enter.bounds, regions.border);
  assert.deepEqual(animationRegion('slot-no-energy-exit', nodes, [], { screenSize }, screenSize), enter);
  assert.throws(() => slotNoEnergyRegions(nodes.filter(n => n.res !== 'confirm-button'), screenSize), /缺少原生/);
  assert.throws(() => slotNoEnergyRegions(nodes.filter(n => n.bounds.width !== 904), screenSize), /真实原生面板/);
});

test('老虎机按真实 iOS 裁剪窗口识别三个滚轮，排除屏幕外长条图案与单行容器', () => {
  const symbols = [281, 506, 731].flatMap(x => [1176, 1356, 1536, 1716, 1896].map(y => ({
    res: 'assets/slot_item_coin@3x.png', bounds: { x, y, width: 154, height: 150 }, children: [],
  })));
  const row = { bounds: { x: 236, y: 1341, width: 679, height: 180 }, children: symbols };
  const window = { bounds: { x: 218, y: 1344, width: 724, height: 534 }, children: [row] };
  const screen = { bounds: { x: 0, y: 0, width: 1178, height: 2556 }, children: [window] };
  const actual = slotReelRegions([screen, window, row, ...symbols]);
  assert.deepEqual(slotReelRegions([screen]), actual, '保留真实裁剪父节点，即使该容器本身不单独可访问');
  assert.deepEqual(actual.window, window.bounds);
  assert.deepEqual(actual.reels, [281, 506, 731].map(x => ({ x, y: 1344, width: 154, height: 534 })));
  assert.throws(() => slotReelRegions([{ ...window, children: symbols.filter(s => s.bounds.x !== 731) }]), /三个/);
});
