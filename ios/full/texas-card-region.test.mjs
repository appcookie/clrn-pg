import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeOwnCardRegion, nativeCommunityCardRegion } from './texas-card-region.ts';
const screen = { width: 1178, height: 2556 };
const player = { res: 'texas-holdem-player-container-self-operating',
  bounds: { x: 401, y: 2040, width: 163, height: 291 } };
const card = x => ({ res: 'player_card', visible: false,
  bounds: { x, y: 2103, width: 112, height: 162 }, children: [
    { res: 'player_card_name_text', text: 'back', bounds: { x, y: 2262, width: 112, height: 54 } },
  ] });
const pair = [card(578), card(689)];
const root = { bounds: { x: 0, y: 0, ...screen }, children: pair };
const publicCards = [257, 389, 524, 656, 791].map((x, i) => ({
  res: 'community_card', bounds: { x, y: 1203, width: i === 3 ? 133 : 130, height: 192 },
}));
test('各街裁图保留真实公共牌边缘，包括原固定裁图漏掉的转牌和河牌左边', () => {
  assert.deepEqual(nativeCommunityCardRegion(publicCards, 'flop', screen), { x: 253, y: 1199, width: 405, height: 200 });
  assert.deepEqual(nativeCommunityCardRegion(publicCards, 'turn', screen), { x: 652, y: 1199, width: 141, height: 200 });
  assert.deepEqual(nativeCommunityCardRegion(publicCards, 'river', screen), { x: 787, y: 1199, width: 138, height: 200 });
});
test('缺失或重叠公共牌位不能进入动画采样', () => {
  assert.throws(() => nativeCommunityCardRegion(publicCards.slice(1), 'flop', screen), /五个/);
  const overlap = publicCards.map(n => ({ ...n, bounds: { ...n.bounds } })); overlap[1].bounds.x = 270;
  assert.throws(() => nativeCommunityCardRegion(overlap, 'turn', screen), /不重叠/);
});
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
