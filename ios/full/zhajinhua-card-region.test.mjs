import test from 'node:test';
import assert from 'node:assert/strict';
import { zhajinhuaCardRegions, currentZhajinhuaCards } from './zhajinhua-card-region.ts';
const screen = { width: 1178, height: 2556 };
const player = (id, x, y, width, height) => ({ res: `zhajinhua-player-container-${id}`, bounds: { x, y, width, height } });
const card = (x, y, width, height) => ({ res: 'player_card', bounds: { x, y, width, height } });
const self = player('self', 401, 2040, 163, 291), other = player('other', 50, 1326, 160, 291);
const cards = [card(578, 2103, 112, 162), card(641, 2103, 112, 162), card(704, 2103, 112, 162),
  ...Array.from({ length: 3 }, () => card(32, 1485, 46, 63))];
const root = { bounds: { x: 0, y: 0, ...screen }, children: [self, other, ...cards] };
test('重复扁平引用只计一次，重叠的三张真实对手牌分别保留', () => {
  const nodes = [root, self, other, ...cards.slice(0, 5)];
  assert.equal(currentZhajinhuaCards(nodes).length, 6);
  assert.deepEqual(zhajinhuaCardRegions(nodes, ['self', 'other'], screen), [
    { x: 574, y: 2099, width: 246, height: 170 }, { x: 28, y: 1481, width: 54, height: 71 },
  ]);
});
test('隐藏历史牌、少牌或缺可见玩家均不能代替当前发牌准备', () => {
  assert.throws(() => zhajinhuaCardRegions([root, self], ['self', 'other'], screen), /可见玩家/);
  assert.throws(() => zhajinhuaCardRegions([self, other, ...cards.slice(1)], ['self', 'other'], screen), /三个/);
  assert.throws(() => zhajinhuaCardRegions([root, self, other, card(900, 20, 46, 63)], ['self', 'other'], screen), /历史牌/);
});
