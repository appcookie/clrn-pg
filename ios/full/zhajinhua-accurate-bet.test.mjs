import test from 'node:test';
import assert from 'node:assert/strict';
import { accurateBetEntrance, accurateBetPanel, accurateBetEndpointMasks,
  prepareAccurateBetEntrance, readyAccurateBetPanel } from './zhajinhua-accurate-bet.ts';
import { zhajinhuaOperationMarkers } from './zhajinhua-operation-region.ts';
const screen = { width: 1178, height: 2556 };
const node = (res, bounds) => ({ res, bounds, visible: true, enabled: true });
const controls = zhajinhuaOperationMarkers.map((marker, index) => node(marker,
  { x: 10 + index * 30, y: 1900, width: 20, height: 50 }));
const panel = node('accurate-bet-popup-container', { x: 223, y: 854, width: 732, height: 848 });
const mask = node('screen-mask-touch-to-close', { x: 0, y: 0, ...screen });

test('精确加注各阶段使用新回合与新树；仅清理实际存在的上一弹窗，不重试动作', async () => {
  for (const existing of [false, true]) {
    const calls = [], current = existing ? [panel, mask] : controls;
    let reads = 0;
    const device = { screenSize: screen, nodes: async () => { calls.push('tree'); return reads++ ? controls : current; },
      input: { tap: async point => { calls.push('cleanup-tap'); assert.deepEqual(point, accurateBetPanel(current, screen).close); } } };
    const prepared = await prepareAccurateBetEntrance(device, async () => { calls.push('fresh-switch-player'); });
    assert.deepEqual(calls, ['tree', ...(existing ? ['cleanup-tap'] : []), 'fresh-switch-player', 'tree']);
    assert.equal(prepared.nodes, controls);
    assert.equal(prepared.button.res, 'zhajinhua-operation-accurate-bet-button');
    assert.ok(prepared.completedAt <= Date.now());
  }
  let reads = 0;
  const observed = await readyAccurateBetPanel({ screenSize: screen,
    nodes: async () => { reads++; return [panel, mask]; } });
  assert.equal(reads, 1);
  assert.equal(observed.panel, panel);
  assert.equal(observed.nodes[0], panel);
  await assert.rejects(prepareAccurateBetEntrance({ nodes: async () => { throw new Error('AX disconnected'); } },
    async () => assert.fail('must not start a turn after driver error')), /AX disconnected/);
});

test('入口不得接受遗留弹窗；退场不得接受缺失或裁断弹窗、无效遮罩', () => {
  assert.equal(accurateBetEntrance(controls, screen).res, 'zhajinhua-operation-accurate-bet-button');
  assert.throws(() => accurateBetEntrance([...controls, panel], screen), /必须消失/);
  assert.throws(() => accurateBetEntrance(controls.slice(1), screen), /原生控件/);
  assert.throws(() => accurateBetPanel([mask], screen), /真实弹窗/);
  assert.throws(() => accurateBetPanel([panel, { ...mask, enabled: false }], screen), /关闭遮罩/);
  assert.throws(() => accurateBetPanel([{ ...panel, bounds: { ...panel.bounds, x: -1 } }, mask], screen), /完整位于/);
});

test('精确加注只遮端点实际背景时钟，完整键盘不能被固定坐标遮掉', () => {
  const clock = node('countdown-text', { x: 566, y: 1449, width: 184, height: 45 });
  assert.deepEqual(accurateBetEndpointMasks([clock]).map(({ reason, ...bounds }) => bounds), [clock.bounds]);
  assert.deepEqual(accurateBetEndpointMasks([clock, panel]), []);
});

test('入退场复用本阶段刚完成的观测，保留新截图和唯一动作及真实终点验证', async () => {
  const { PNG } = await import('pngjs');
  const { captureNativeTransition } = await import('./animation-transition.ts');
  const size = { width: 360, height: 600 };
  const popup = node('accurate-bet-popup-container', { x: 90, y: 150, width: 180, height: 240 });
  const backdrop = node('screen-mask-touch-to-close', { x: 0, y: 0, ...size });
  const buttons = zhajinhuaOperationMarkers.map((marker, i) => node(marker,
    { x: 10 + i * 35, y: 450, width: 20, height: 30 }));
  const picture = scale => {
    const png = new PNG(size);
    for (let offset = 0; offset < png.data.length; offset += 4) png.data.set([20, 80, 50, 255], offset);
    const b = popup.bounds, width = Math.round(b.width * scale), height = Math.round(b.height * scale);
    const left = b.x + (b.width - width) / 2, top = b.y + (b.height - height) / 2;
    for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++)
      png.data.set(x % 10 < 2 ? [240, 240, 240, 255] : [230, 40, 60, 255], (y * size.width + x) * 4);
    return PNG.sync.write(png);
  };
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  try {
    for (const phase of ['enter', 'exit']) {
      const before = picture(phase === 'enter' ? 0 : 1), after = picture(phase === 'enter' ? 1 : 0);
      const beforeNodes = phase === 'enter' ? buttons : [popup, backdrop];
      const afterNodes = phase === 'enter' ? [popup, backdrop] : buttons;
      let reads = 0, screenshots = 0, taps = 0;
      const device = { screenSize: size, nodes: async () => { reads++; return afterNodes; },
        nativeScreenshot: async () => screenshots++ ? after : before };
      await captureNativeTransition(device, `zhajinhua-accurate-bet-${phase}`, { attach: async () => {} },
        popup.bounds, () => { taps++; }, [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [], [],
        async (_device, _name, _bounds, action) => { await action(); return [before, picture(.6), after]; },
        undefined, { nodes: beforeNodes, completedAt: Date.now() });
      assert.deepEqual({ reads, screenshots, taps }, { reads: 1, screenshots: 2, taps: 1 });
    }
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
});

test('Cancel后的原始disabled父层仍可定位入口，阻断alert立即拒绝而不消耗新回合', async () => {
  const { readFileSync } = await import('node:fs');
  const { after } = JSON.parse(readFileSync(new URL('./fixtures/zhajinhua-cancel-motion/native-state.json', import.meta.url)));
  const entry = accurateBetEntrance([after], screen);
  assert.equal(entry.res, 'zhajinhua-operation-accurate-bet-button');
  assert.equal(entry.visible, false); // Preserve the observed AX field.
  for (const alert of [node('common-alert-message', panel.bounds),
    { ...node('alert', panel.bounds), clazz: 'XCUIElementTypeAlert' },
    { ...node('message', panel.bounds), text: 'Connection Timeout' }]) {
    let reads = 0;
    await assert.rejects(prepareAccurateBetEntrance({ nodes: async () => { reads++; return [...controls, alert]; } },
      async () => assert.fail('blocked setup cannot start a turn')), /阻断错误/);
    assert.equal(reads, 1);
    reads = 0;
    await assert.rejects(readyAccurateBetPanel({ screenSize: screen,
      nodes: async () => { reads++; return [panel, mask, alert]; } }), /阻断错误/);
    assert.equal(reads, 1);
  }
});

test('精确加注原生ROI包含边缘；旧估算或单像素截断立即失败', async () => {
  const { assertAccurateBetRegion } = await import('./zhajinhua-accurate-bet.ts');
  const actualPanel = { ...panel, bounds: { x: 227, y: 858, width: 724, height: 840 } };
  const region = { x: 223, y: 854, width: 732, height: 848 };
  assert.doesNotThrow(() => assertAccurateBetRegion([actualPanel, mask], screen, region));
  for (const clipped of [{ ...region, width: 731 }, { ...region, height: 847 }, { ...region, x: 224 }, actualPanel.bounds])
    assert.throws(() => assertAccurateBetRegion([actualPanel, mask], screen, clipped), /完整原生弹窗/);
});
