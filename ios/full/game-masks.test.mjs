import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenshotMaskNodes, seatGuideMotionBounds, visibleMasks, seatGuideBackgroundMasks } from './game-masks.ts';

test('modal-hidden seat guides remain maskable without promoting other hidden controls', () => {
  const arrow = { res: 'seat-guide-6', bounds: { x: 746, y: 303, width: 73, height: 63 } };
  const button = { res: 'hidden-buy-in-button', bounds: arrow.bounds };
  const root = { bounds: { x: 0, y: 0, width: 1178, height: 2556 }, children: [arrow, button] };
  assert.deepEqual(screenshotMaskNodes([root]), [root, arrow]);
  assert.deepEqual(screenshotMaskNodes([root, arrow]), [root, arrow]);
});

test('real menu geometry preserves every foreground pixel while masking exposed arrow travel', () => {
  const panel = { bounds: { x: 0, y: 0, width: 492, height: 1461 } };
  const hidden = { res: 'seat-guide-5', bounds: { x: 341, y: 303, width: 76, height: 63 } };
  const exposed = { res: 'seat-guide-6', bounds: { x: 746, y: 303, width: 73, height: 63 } };
  const mask = node => ({ ...seatGuideMotionBounds(node.bounds), reason: node.res });
  assert.deepEqual(visibleMasks(mask(hidden), hidden, [panel]), []);
  assert.deepEqual(visibleMasks(mask(exposed), exposed, [panel]), [mask(exposed)]);
});

test('guide keyframes retain pixels beyond the native layout box throughout travel', () => {
  const bounds = seatGuideMotionBounds({ x: 998, y: 1356, width: 76, height: 63 });
  assert.deepEqual(bounds, { x: 997, y: 1320, width: 78, height: 135 });
  // Real animation-15 moved image reached the old crop's bottom edge (1419).
  assert.ok(bounds.y + bounds.height > 1419);
});

test('panel endpoint masks recover hidden background guides and subtract the current native menu', () => {
  const hidden = { res: 'seat-guide-5', bounds: { x: 341, y: 303, width: 76, height: 63 } };
  const exposed = { res: 'seat-guide-6', bounds: { x: 746, y: 303, width: 73, height: 63 } };
  const exit = { res: 'drawer-menu-item-exit', bounds: { x: 0, y: 1329, width: 492, height: 132 } };
  const panel = { bounds: { x: 0, y: 0, width: 492, height: 1461 }, children: [exit] };
  const screen = { width: 1178, height: 2556 };
  const root = { bounds: { x: 0, y: 0, ...screen }, children: [hidden, exposed, panel] };
  const masks = seatGuideBackgroundMasks([root, panel, exit], screen);
  assert.equal(masks.length, 1);
  assert.deepEqual(masks[0], { ...seatGuideMotionBounds(exposed.bounds),
    reason: 'seat-guide-6 独立箭头动画；前景内容仍比较' });
});
