import test from 'node:test';
import assert from 'node:assert/strict';
import { texasRaiseControls, texasRaiseRegion } from './texas-raise-region.ts';
const node = (res, bounds, visible = false, children = []) => ({ res, bounds, visible, enabled: true, children });
const slider = node('raise-bet-slider', { x: 497, y: 663, width: 544, height: 930 });
const thumb = node('sliderThumb', { x: 752, y: 1503, width: 34, height: 90 });
const value = node('raise-bet-display-text', { x: 749, y: 1521, width: 64, height: 60 });
const cancel = node('raise-bet-cancel-button', { x: 221, y: 1695, width: 190, height: 186 }, true);
const confirm = node('raise-bet-confirm-button', { x: 767, y: 1695, width: 190, height: 186 }, true);
const screen = { width: 1178, height: 2556 };
const root = node('raise-bet-popup', { x: 0, y: 0, ...screen }, true, [slider, thumb, value, cancel, confirm]);
test('加注动画包括整个标尺、滑块和两按钮，排除全屏变暗遮罩', () => {
  assert.deepEqual(texasRaiseRegion([root], screen), { x: 217, y: 659, width: 828, height: 1226 });
  assert.equal(texasRaiseControls([root]).thumb, thumb);
});
test('隐藏根、按钮缺失、其他弹窗滑块和重复语义不能冒充当前加注控件', () => {
  for (const broken of [[], [slider, thumb, value, cancel, confirm], [{ ...root, visible: false }],
    [{ ...root, children: [slider, thumb, value, cancel] }],
    [{ ...root, children: [...root.children, { ...slider }] }],
    [{ ...root, children: [slider, thumb, value, { ...cancel, visible: false }, confirm] }]]) {
    assert.throws(() => texasRaiseControls(broken));
  }
});
