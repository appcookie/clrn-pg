import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeLevelUpRegions } from './level-up-region.ts';
const screen = { width: 1178, height: 2556 };
const title = { res: 'level-up-title', bounds: { x: 182, y: -2439, width: 814, height: 72 } };
const timer = { res: 'countdown_timer_text', bounds: { x: 29, y: -2265, width: 58, height: 60 } };
const close = { res: 'level-up-close-button', bounds: { x: 1082, y: -2526, width: 67, height: 90 } };
const panel = { bounds: { x: 0, y: -2556, width: 1178, height: 384 }, children: [title, timer, close] };
const root = { bounds: { x: 0, y: 0, ...screen }, children: [panel] };
test('升级提示读取实际隐藏布局，完整包含右侧关闭按钮并准确定位秒数', () => {
  assert.deepEqual(nativeLevelUpRegions([root, title], screen), {
    panel: { x: 0, y: 0, width: 1178, height: 384 },
    title: { x: 182, y: 117, width: 814, height: 72 },
    timer: { x: 29, y: 291, width: 58, height: 60 },
  });
});
test('旧提示未消失、缺控件、重复控件或内容超出面板都失败', () => {
  assert.throws(() => nativeLevelUpRegions([{ ...panel, bounds: { ...panel.bounds, y: 0 } }], screen), /尚未出现/);
  assert.throws(() => nativeLevelUpRegions([{ ...panel, children: [title, close] }], screen), /唯一/);
  assert.throws(() => nativeLevelUpRegions([root, { ...timer }], screen), /唯一/);
  assert.throws(() => nativeLevelUpRegions([{ ...panel, bounds: { ...panel.bounds, height: 200 } }], screen), /完整位于/);
});

test('拼三张使用自己的原生标题和关闭按钮，不能误用德州 testID', () => {
  const zh = { ...panel, children: [
    { ...title, res: 'zhajinhua-level-up-level-text' }, timer,
    { ...close, res: 'zhajinhua-level-up-close-button' },
  ] };
  assert.deepEqual(nativeLevelUpRegions([zh], screen, 'zhajinhua'), nativeLevelUpRegions([root], screen));
  assert.throws(() => nativeLevelUpRegions([zh], screen, 'texas-holdem'), /唯一/);
  assert.throws(() => nativeLevelUpRegions([root], screen, 'zhajinhua'), /唯一/);
});
