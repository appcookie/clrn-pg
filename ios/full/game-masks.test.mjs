import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenshotMaskNodes, seatGuideMotionBounds, visibleMasks, seatGuideBackgroundMasks, leaderboardRoomIdentityMask } from './game-masks.ts';

test('modal-hidden seat guides remain maskable without promoting other hidden controls', () => {
  const arrow = { res: 'seat-guide-6', bounds: { x: 746, y: 303, width: 73, height: 63 } };
  const button = { res: 'hidden-buy-in-button', bounds: arrow.bounds };
  const root = { bounds: { x: 0, y: 0, width: 1178, height: 2556 }, children: [arrow, button] };
  assert.deepEqual(screenshotMaskNodes([root]), [root, arrow]);
  assert.deepEqual(screenshotMaskNodes([root, arrow]), [root, arrow]);
});

test('challenge overlay keeps the visible room clock mask when accessibility marks its node hidden', () => {
  const clock = { res: 'countdown-text', text: '00:38:11', visible: false,
    bounds: { x: 566, y: 1449, width: 184, height: 45 } };
  const unrelated = { res: 'countdown-text', text: 'not a room clock', visible: false,
    bounds: { x: 10, y: 10, width: 184, height: 45 } };
  const root = { bounds: { x: 0, y: 0, width: 1178, height: 2556 }, children: [clock, unrelated] };
  assert.deepEqual(screenshotMaskNodes([root]), [root, clock]);
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
  assert.deepEqual(bounds, { x: 997, y: 1320, width: 80, height: 135 });
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


test('真实排行榜 UUID 仅排除固定的单行文本槽，不触及表头与数据', () => {
  const screen = { width: 1178, height: 2556 };
  const node = { res: 'leader-board-room-id', text: '166afe2c-b813-45f3-8bad-d1bce61ef6e3',
    bounds: { x: 158, y: 2490, width: 613, height: 36 } };
  const mask = leaderboardRoomIdentityMask(node, screen);
  assert.deepEqual(mask, { x: 105, y: 2490, width: 720, height: 36, reason: 'leader-board-room-id' });
  assert.deepEqual(leaderboardRoomIdentityMask({ ...node,
    bounds: { ...node.bounds, x: 168, width: 593 } }, screen), mask);
  assert.throws(() => leaderboardRoomIdentityMask({ ...node, text: 'Profit' }, screen), /单行 UUID/);
  assert.throws(() => leaderboardRoomIdentityMask({ ...node,
    bounds: { ...node.bounds, height: 2000 } }, screen), /单行 UUID/);
});
