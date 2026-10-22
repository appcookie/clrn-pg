import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingCardsState, remainingCardsBackgroundMasks } from './remaining-community-cards.ts';

const rect = (x, y, width, height) => ({ x, y, width, height });
const node = (res, text, bounds) => ({ res, text, bounds, visible: true, enabled: true });
const popup = node('view-community-cards-container', '', rect(300, 400, 580, 430));
const popupNodes = [popup, node('view-community-close-button', '', rect(820, 410, 40, 40)),
  node('view-community-cards-countdown', '9', rect(570, 470, 40, 45)),
  ...['ah', 'kd', '7c', '2s', 'qs'].map((card, index) =>
    node('community_card_name_text', card, rect(330 + index * 100, 690, 40, 30)))];

test('remaining cards use the five live names inside the modal, ignoring table cards', () => {
  const state = remainingCardsState([...popupNodes,
    node('community_card_name_text', 'back', rect(40, 1200, 40, 30))]);
  assert.deepEqual(state, { container: popup.bounds, countdown: popupNodes[2] });
  const labelBelowPopup = popupNodes.map(item => item.res === 'community_card_name_text'
    ? { ...item, bounds: { ...item.bounds, y: 880 } } : item);
  assert.deepEqual(remainingCardsState(labelBelowPopup), state);
});

test('incomplete cards or reconnect cannot establish the transient state', () => {
  assert.equal(remainingCardsState(popupNodes.slice(0, -1)), undefined);
  assert.equal(remainingCardsState([...popupNodes, node('connecting', 'Connecting...', rect(0, 0, 100, 40))]), undefined);
  assert.equal(remainingCardsState([...popupNodes.slice(0, -1),
    node('community_card_name_text', 'back', rect(730, 690, 40, 30))]), undefined);
});

test('preparing background masks preserves room clock, network status, and active countdown', () => {
  const nodes = [
    node('ping-screen-container', '', rect(970, 200, 200, 140)),
    node('game-network-proxy-code', '0', rect(1079, 2496, 52, 48)),
    node('texas-holdem-active-countdown', '', rect(48, 1387, 164, 166)),
  ];
  const masks = remainingCardsBackgroundMasks(nodes, { width: 1178, height: 2556 });
  assert.deepEqual(masks.map(mask => mask.reason), [
    '网络延迟数值、图标与前后端延迟比例条', 'game-network-proxy-code',
    'texas-holdem-active-countdown 含两像素绘制边缘',
  ]);
});
