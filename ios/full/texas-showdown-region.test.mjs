import test from 'node:test';
import assert from 'node:assert/strict';
import { texasShowdownRegion, texasEffectEndpointMasks } from './texas-showdown-region.ts';

const screen = { width: 1178, height: 2556 };
const node = (res, bounds, children = [], text) => ({ res, bounds, children, text, visible: true });
const publicCards = [257, 389, 524, 656, 791].map(x =>
  node('community_card', { x, y: 1203, width: 130, height: 192 }));
const self = node('texas-holdem-player-container-self', { x: 401, y: 2040, width: 163, height: 291 },
  [node('texas-holdem-self-seated-marker', { x: 560, y: 2178, width: 454, height: 54 })]);
const bar = node('assets/img_hand_card_hot_bar@3x.png', { x: 587, y: 2340, width: 166, height: 12 });
const banner = node('showdown-assist-view-container', { x: 0, y: 1410, width: 1178, height: 150 },
  [node('showdown-assist-view-strength-text', { x: 398, y: 1443, width: 256, height: 84 }, [], '3 of Kind')]);
const clock = node('countdown-text', { x: 584, y: 1434, width: 184, height: 45 }, [], '00:58:13');

test('摊牌完整范围保留1178px横幅右端、五张公共牌和本人牌力条', () => {
  const before = [...publicCards, self, bar, clock];
  assert.deepEqual(texasShowdownRegion(before, [...before, banner], screen),
    { x: 0, y: 1199, width: 1178, height: 1157 });
  assert.throws(() => texasShowdownRegion(before, before, screen), /获胜横幅/);
  assert.throws(() => texasShowdownRegion(before, [...before, banner, banner], screen), /获胜横幅/);
  assert.throws(() => texasShowdownRegion(before.slice(1), [...before, banner], screen), /五张/);
  assert.throws(() => texasShowdownRegion(before, [...before, { ...banner, bounds: { ...banner.bounds, width: 1200 } }],
    screen), /屏幕内/);
});

test('端点背景秒数可排除，但获胜横幅和全压后的明牌不得被抹掉', () => {
  assert.equal(texasEffectEndpointMasks('texas-showdown', [clock], screen).length, 1);
  assert.deepEqual(texasEffectEndpointMasks('texas-showdown', [clock, banner], screen), []);
  const timer = node('texas-holdem-active-countdown', { x: 50, y: 1389, width: 160, height: 162 });
  const player = node('texas-holdem-player-container-opponent-operating',
    { x: 50, y: 1326, width: 160, height: 288 }, [timer]);
  assert.equal(texasEffectEndpointMasks('texas-all-in-fire', [player], screen).length, 1);
  const cards = node('texas-holdem-player-hole-cards', { x: 2, y: 1374, width: 283, height: 210 });
  assert.deepEqual(texasEffectEndpointMasks('texas-all-in-fire', [player, cards], screen), []);
  assert.deepEqual(texasEffectEndpointMasks('unrelated', [clock, player], screen), []);
});
