import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeOwnCardRegion } from './texas-card-region.ts';
const screen = { width: 1178, height: 2556 };
const player = { res: 'texas-holdem-player-container-self-operating',
  bounds: { x: 401, y: 2040, width: 163, height: 291 } };
const card = x => ({ res: 'player_card', visible: false,
  bounds: { x, y: 2103, width: 112, height: 162 }, children: [
    { res: 'player_card_name_text', text: 'back', bounds: { x, y: 2262, width: 112, height: 54 } },
  ] });
const pair = [card(578), card(689)];
const root = { bounds: { x: 0, y: 0, ...screen }, children: pair };
test('真实iOS背面牌按本人位置读取，保留超出旧Android裁图的左边缘', () => {
  assert.deepEqual(nativeOwnCardRegion([root, player, root], 'self', screen),
    { bounds: { x: 574, y: 2099, width: 231, height: 170 }, cards: ['back', 'back'] });
});
test('缺本人、缺牌、额外牌位或冲突语义均不能当作准备完成', () => {
  assert.throws(() => nativeOwnCardRegion([root], 'self', screen), /本人可见/);
  assert.throws(() => nativeOwnCardRegion([player, pair[0]], 'self', screen), /恰好/);
  assert.throws(() => nativeOwnCardRegion([root, player, card(820)], 'self', screen), /恰好/);
  const conflicting = card(578); conflicting.children[0].text = 'as';
  assert.throws(() => nativeOwnCardRegion([root, player, conflicting], 'self', screen), /冲突/);
});
