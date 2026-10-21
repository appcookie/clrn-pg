import test from 'node:test';
import assert from 'node:assert/strict';
import { texasRaiseClockMasks, texasRaiseValueMask } from './texas-raise-masks.ts';

const screen = { width: 1178, height: 2556 };
const n = (res, bounds, children = [], text, clazz = 'XCUIElementTypeOther', visible = false) =>
  ({ res, bounds, children, text, clazz, visible, enabled: true });
function fixture() {
  const value = n('raise-bet-display-text', { x: 749, y: 1521, width: 64, height: 60 }, [], '40', 'XCUIElementTypeStaticText');
  const image = n(undefined, { x: 662, y: 1503, width: 232, height: 99 }, [], undefined, 'XCUIElementTypeImage', true);
  const thumb = n('sliderThumb', { x: 752, y: 1503, width: 34, height: 90 }, [image, value]);
  const slider = n('raise-bet-slider', { x: 497, y: 663, width: 544, height: 930 });
  const rail = n(undefined, { x: 545, y: 1452, width: 7, height: 84 });
  const scale = n('232', { x: 572, y: 1356, width: 73, height: 45 }, [], '232', 'XCUIElementTypeStaticText');
  const ruler = n(undefined, { x: 527, y: 681, width: 154, height: 900 }, [rail, scale], undefined, 'XCUIElementTypeScrollView');
  const cancel = n('raise-bet-cancel-button', { x: 221, y: 1695, width: 190, height: 186 }, [], undefined, undefined, true);
  const confirm = n('raise-bet-confirm-button', { x: 767, y: 1695, width: 190, height: 186 }, [], undefined, undefined, true);
  const root = n('raise-bet-popup', { x: 0, y: 0, ...screen }, [slider, thumb, ruler, cancel, confirm], undefined, undefined, true);
  const clock = n('countdown-text', { x: 584, y: 1434, width: 184, height: 45 }, [], '00:57:22', 'XCUIElementTypeStaticText');
  const icon = n('assets/src/texas_holdem_react_native/main/component/room-profile/resource/image/icon_room_countdown_green@3x.png',
    { x: 536, y: 1437, width: 40, height: 39 }, [], undefined, 'XCUIElementTypeImage');
  return { nodes: [root, clock, icon], root, clock, icon, value, image, thumb, ruler, rail, scale, cancel, confirm };
}
const covered = (masks, x, y) => masks.some(b => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height);
test('加注端点和静态图只排除实际房间clock文字，隐藏native背景仍正确识别', () => {
  const f = fixture(), masks = texasRaiseClockMasks(f.nodes, screen);
  assert.deepEqual(masks.map(({ reason, ...b }) => b), [{ x: 584, y: 1434, width: 184, height: 45 }]);
  assert.equal(covered(masks, 549, 1455), false);
  assert.deepEqual(texasRaiseClockMasks([f.clock, f.icon], screen), masks);
});
test('clock遮罩必须扣除实际刻度、轨道、金色thumb和确认取消按钮', () => {
  for (const key of ['scale', 'rail', 'image', 'cancel', 'confirm']) {
    const f = fixture();
    if (key === 'image') {
      f.image.bounds.y = 1400; f.value.bounds.y = 1418;
    } else f[key].bounds = { x: 600, y: 1440, width: 10, height: 12 };
    const masks = texasRaiseClockMasks(f.nodes, screen);
    const b = f[key].bounds;
    assert.equal(covered(masks, Math.max(584, b.x) + 1, Math.max(1434, b.y) + 1), false, key);
    assert.equal(covered(masks, 585, 1435), true, key);
  }
});
test('错误clock身份、布局、重复节点或丢失前景证据不得扩大排除区域', () => {
  const changes = [f => f.nodes.pop(), f => f.clock.text = 'arbitrary',
    f => f.clock.bounds.width = 900, f => f.clock.bounds.x = 0,
    f => f.clock.bounds.y = 1200, f => f.nodes.push({ ...f.clock, text: '00:57:21' }),
    f => f.ruler.children = [], f => f.root.children.splice(f.root.children.indexOf(f.ruler), 1)];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => texasRaiseClockMasks(f.nodes, screen)); }
});
test('量化数字使用actual金色thumb内固定文字槽，保留边框和位置并覆盖不同数字位宽', () => {
  const f = fixture(), masks = texasRaiseValueMask(f.nodes, screen);
  assert.deepEqual(masks.map(({ reason, ...b }) => b), [{ x: 701, y: 1521, width: 154, height: 63 }]);
  f.value.text = '1000'; f.value.bounds = { x: 717, y: 1521, width: 128, height: 60 };
  assert.deepEqual(texasRaiseValueMask(f.nodes, screen), masks);
  assert.equal(covered(masks, 663, 1550), false);
  assert.equal(covered(masks, 800, 1504), false);
  assert.equal(covered(masks, 549, 1538), false);
});
test('数字溢出、错误格式、图片超界、遮刻度或按钮均拒绝生成value遮罩', () => {
  const changes = [f => f.value.text = 'ALL IN', f => f.value.bounds.width = 160,
    f => f.image.bounds.width = 1000, f => f.image.bounds.x = 500,
    f => f.confirm.bounds = { x: 750, y: 1520, width: 100, height: 80 },
    f => f.thumb.bounds.y -= 10];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => texasRaiseValueMask(f.nodes, screen)); }
});

const nativeFixture = new URL('./fixtures/texas-raise-hidden-thumb/', import.meta.url);
async function recordedFixture() {
  const { readFileSync } = await import('node:fs');
  return JSON.parse(readFileSync(new URL('native-state.json', nativeFixture)));
}
test('真实40→618拖动后AX隐藏金色图片仍按唯一原生ImageBackground定位，保留原visible值', async () => {
  const { before, after } = await recordedFixture();
  assert.deepEqual(texasRaiseValueMask(before, screen).map(({ reason, ...b }) => b),
    [{ x: 701, y: 1521, width: 154, height: 63 }]);
  assert.deepEqual(texasRaiseValueMask(after, screen).map(({ reason, ...b }) => b),
    [{ x: 701, y: 1015, width: 154, height: 64 }]);
  const controls = (await import('./texas-raise-region.ts')).texasRaiseControls(after);
  const background = controls.thumb.children[0], image = background.children[0];
  assert.equal(controls.value.text, '618');
  assert.equal(image.visible, false);
  assert.equal(background.visible, false);
  assert.equal(controls.thumb.visible, false);
  assert.deepEqual(texasRaiseClockMasks(after, screen).map(({ reason, ...b }) => b),
    [{ x: 584, y: 1434, width: 184, height: 45 }]);
  for (const point of [[663, 1040], [800, 997], [549, 1030]])
    assert.equal(covered(texasRaiseValueMask(after, screen), ...point), false);
});

test('隐藏图片兼容只接受原生thumb精确子树，错误包装、重复、禁用或越界均拒绝', async () => {
  const { texasRaiseControls } = await import('./texas-raise-region.ts');
  const changes = [
    f => { f.image.enabled = false; }, f => { f.image.res = 'unrelated-image'; },
    f => { f.root.enabled = false; }, f => { f.thumb.enabled = false; }, f => { f.value.enabled = false; },
    f => { f.wrapper.enabled = false; }, f => { f.wrapper.visible = true; },
    f => { f.wrapper.res = 'unrelated'; }, f => { f.wrapper.clazz = 'XCUIElementTypeScrollView'; },
    f => { f.wrapper.bounds = { ...f.wrapper.bounds, width: f.wrapper.bounds.width + 1 }; },
    f => { f.wrapper.children.push({ ...f.image }); },
    f => { f.thumb.children = [f.image, f.value]; },
    f => { f.thumb.children.push({ ...f.wrapper }); },
    f => { f.thumb.visible = true; }, f => { f.value.visible = true; },
    f => { f.root.bounds = { ...f.root.bounds, height: 2555 }; },
    f => { f.confirm.visible = false; }, f => { f.value.bounds.x = 0; },
    f => { f.image.bounds.x = -1; },
  ];
  for (const change of changes) {
    const { after } = await recordedFixture(), { thumb, value, confirm } = texasRaiseControls(after);
    const wrapper = thumb.children[0], image = wrapper.children[0];
    change({ root: after[0], thumb, value, confirm, wrapper, image });
    assert.throws(() => texasRaiseValueMask(after, screen));
  }
});

test('原始录像金色滑块和完整数字实际向上移动，静态硬切不能充当中间帧', async () => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { nativeRecordedTargetMotionEvidence } = await import('./animation-transition.ts');
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', nativeFixture)));
  const frames = provenance.images.map(image => {
    const bytes = readFileSync(new URL(image.file, nativeFixture));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
    return bytes;
  });
  const real = await nativeRecordedTargetMotionEvidence(frames[0], frames[2], frames);
  assert.ok(real.total > 3);
  assert.deepEqual(real.candidates.map(item => item.index), [1]);
  const hardCut = await nativeRecordedTargetMotionEvidence(frames[0], frames[2], [frames[0], frames[2], frames[2]]);
  assert.equal(hardCut.candidates.length, 0);
});
