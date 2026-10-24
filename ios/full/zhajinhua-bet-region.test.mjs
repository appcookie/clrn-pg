import test from 'node:test';
import assert from 'node:assert/strict';
import { zhajinhuaBetRegion } from './zhajinhua-bet-region.ts';

const screen = { width: 1178, height: 2556 };
// Real shared player bet-panel geometry from 39525488584. The coin extends
// 18 px left of the black panel and is marked hidden by Fabric.
function player(id, amount = '40') {
  return { res: `zhajinhua-player-container-${id}`, children: [{
    clazz: 'XCUIElementTypeOther', visible: true,
    bounds: { x: 146, y: 1485, width: 160, height: 51 }, children: [
      { clazz: 'XCUIElementTypeOther', visible: false, children: [{
        clazz: 'XCUIElementTypeImage', visible: false,
        bounds: { x: 128, y: 1485, width: 52, height: 51 },
      }] },
      { res: 'player_bet_amount_text', text: amount,
        bounds: { x: 176, y: 1485, width: 115, height: 51 } },
    ],
  }] };
}
const before = [{ res: 'zhajinhua-player-container-self-operating' }];
test('快捷加注裁图包含完整原生金额背景和越界筹码图标', () => {
  assert.deepEqual(zhajinhuaBetRegion(before, [player('other'), player('self')], screen),
    { x: 124, y: 1481, width: 186, height: 59 });
});
test('其他玩家、旧下注金额、缺图标和越出屏幕不能代替当前加注', () => {
  assert.throws(() => zhajinhuaBetRegion(before, [player('other')], screen), /当前玩家/);
  assert.throws(() => zhajinhuaBetRegion(before, [player('self', '10')], screen), /40 筹码/);
  const noCoin = player('self');
  noCoin.children[0].children.shift();
  assert.throws(() => zhajinhuaBetRegion(before, [noCoin], screen), /筹码图标/);
  assert.throws(() => zhajinhuaBetRegion(before, [player('self')], { ...screen, height: 1500 }), /屏幕内/);
});
