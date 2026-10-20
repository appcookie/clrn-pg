import { expect } from '@playwright/test';
import { REPLAY_PLAYER_IDS } from '../../visual/cases/texas-holdem/replayData';
import { flattenNodes, gameGone, gameNodes, gameReady, gameTap, gameSemanticText } from './game-controls';
import { closeGameMask } from './game-pregame';
import { gameTapText, restoreTexas, texasEvents, type TexasContext } from './texas-support';

/**
 * 与 Web 共用十三个操作分支，实际点击、拖动原生控件并检查结果。
 * @param context - 当前真实房间、连接与共用顺序截图入口。
 */
export async function texasControlVariants(context: TexasContext): Promise<void> {
  const { device, capture } = context;
  const bets = { fold: {}, check: {}, raise: { minimum: 40, maximum: 1000 }, all_in: { amount: 1000 } };
  await restoreTexas(context, { validBets: bets });
  await gameReady(device, 'texas-holdem-operation-button-check');
  await capture('check');
  await restoreTexas(context, { validBets: { fold: {}, all_in: { amount: 15 } } });
  await gameReady(device, 'texas-holdem-operation-button-all_in');
  await gameGone(device, 'texas-holdem-operation-button-call');
  await capture('all_in_only');
  await restoreTexas(context, { validBets: { fold: {}, call: { amount: 15 }, all_in: { amount: 15 } } });
  await gameReady(device, 'texas-holdem-operation-button-all_in');
  await gameReady(device, 'texas-holdem-operation-button-call');
  await capture('all_in_call');
  await restoreTexas(context, { pots: [3], validBets: bets });
  await gameReady(device, 'texas-holdem-shortcut-raise-button-double_big_blind');
  expect((await gameNodes(device)).filter(node => node.res?.startsWith('texas-holdem-shortcut-raise-button-')
    && !node.res.endsWith('group'))).toHaveLength(4);
  await capture('shortcut_blinds');
  await restoreTexas(context, { validBets: { fold: {}, call: { amount: 20 },
    raise: { minimum: 40, maximum: 50 }, all_in: { amount: 50 } } });
  expect((await gameReady(device, 'texas-holdem-shortcut-raise-button-half_pot')).enabled).toBe(false);
  await capture('shortcut_disabled');
  // 直接恢复对手回合，避免本人异步开始计时与紧随其后的 switch_player 相互覆盖。
  await restoreTexas(context, {}, 'river', true);
  await gameReady(device, `texas-holdem-player-container-${REPLAY_PLAYER_IDS[0]}-operating`);
  await expect.poll(async () => {
    const self = (await gameNodes(device)).find(node => node.res === `texas-holdem-player-container-${context.self}`);
    return self && gameSemanticText(self, 'texas-holdem-bet-amount-text') === '20'
      && flattenNodes(self).some(node => node.res === 'texas-holdem-player-action-call');
  }, { timeout: 30_000 }).toBe(true);
  await texasEvents(context, [{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0], valid_bets: { call: { amount: 20 } } }]);
  await gameGone(device, 'texas-holdem-operation-button-raise');
  await expect.poll(async () => (await gameNodes(device)).some(node => /看或弃|看或棄|Check\/Fold/.test(node.text || ''))).toBe(true);
  await capture('auto_buttons');
  for (const [state, label] of [
    ['auto_fold_selected', /看或弃|看或棄|Check\/Fold/],
    ['auto_call_selected', /一跟到底|Any Call/],
    ['auto_check_selected', /自动看|自動看|^Check$/],
  ] as const) {
    await gameTapText(device, label);
    await capture(state);
  }
  await restoreTexas(context);
  await gameTap(device, 'texas-holdem-operation-button-raise');
  const track = (await gameReady(device, 'raise-bet-slider')).bounds;
  const thumb = (await gameReady(device, 'sliderThumb')).bounds;
  const x = Math.round(thumb.x + thumb.width / 2);
  // 原生手势接管会消耗最初的移动距离；越过轨道顶部，确保真正抵达最大值。
  await device.input.swipe({ x1: Number(String(x)), y1: Number(String(Math.round(thumb.y + thumb.height / 2))), x2: Number(String(x)), y2: Number(String(Math.max(1, Math.round(track.y - track.height / 2)))), duration: Number('1000') });
  await gameReady(device, 'raise-bet-display-text', '1000');
  await gameReady(device, 'raise-bet-all-in-button');
  await capture('raise_maximum');
  const topThumb = (await gameReady(device, 'sliderThumb')).bounds;
  const startY = Math.round(topThumb.y + topThumb.height / 2);
  const targetY = Math.round(track.y + track.height / 2);
  await device.withDragHold({ from: { x, y: startY }, to: { x, y: targetY }, holdMs: 3000 }, async () => {
    // WDA 执行长按时不能并发查询树；simctl 截图仍能采到真正拖动中的辅助文字。
    await capture('raise_dragging', [], undefined, await device.nativeScreenshot());
  });
  await gameReady(device, 'raise-bet-display-text', '520');
  await gameTap(device, 'raise-bet-cancel-button');
  await gameTap(device, 'texas-holdem-operation-accurate-bet-button');
  for (const digit of [1, 2, 3]) await gameTap(device, `texas-holdem-operation-accurate-bet-number-button-${digit}`);
  await gameReady(device, 'accurate-bet-value-text', '123');
  await capture('accurate_raise_value');
  for (let index = 0; index < 3; index++) await gameTap(device, 'texas-holdem-operation-accurate-bet-backspace-button');
  await gameTap(device, 'texas-holdem-operation-accurate-bet-number-button-1');
  await gameReady(device, 'accurate-bet-value-text', '1');
  await capture('accurate_raise_minimum_error', [], async () => {
    await gameTap(device, 'texas-holdem-operation-accurate-bet-confirm-button', true);
    return '40';
  });
  await closeGameMask(device, 'accurate-bet-popup-container');
}
