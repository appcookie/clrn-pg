import { screenBounds } from './screen-geometry';
import { expect } from '@playwright/test';
import { setTimeout } from 'node:timers/promises';
import { REPLAY_PLAYER_IDS } from '../../visual/cases/texas-holdem/replayData';
import { gameGone, gameNodes, gameReady, gameScreenshot, gameTap, gameTextWithin } from './game-controls';
import { closeGameMask } from './game-pregame';
import { dismissKeyboard } from './keyboard';
import { focusedCaretMask } from './screenshot';
import { translateCaret } from './caret-mask';
import { enableGameSetting, restoreTexas, texasEvents, type TexasContext } from './texas-support';
import { animateGamePanel, captureTimedLevelUp } from './game-panel-animation';
import { captureMovingKeyframes } from './loop-keyframes';

/**
 * 复用 Web 的大厅牌桌、自动带入、举报、个人收益、猜牌及升级状态。
 * @param context - 大厅展示夹具下保持真实私人房观察者连接的上下文。
 */
export async function texasHall(context: TexasContext): Promise<void> {
  const { device, proxy, self, capture, animationInfo } = context;
  await restoreTexas(context, {}, 'flop', true);
  await gameReady(device, 'auto-rebuy-button');
  await gameReady(device, 'report-pair-play-button');
  await capture('hall_table');
  await gameTap(device, 'menu-button');
  await gameReady(device, 'drawer-menu-item-exit');
  await capture('hall_menu');
  await closeGameMask(device, 'drawer-menu-item-exit');
  await animateGamePanel(device, 'texas-holdem', 'auto-rebuy', 'auto-rebuy-button',
    screenBounds(device, { x: 320, y: 430, width: 340, height: 400 }), animationInfo, 'enter', 'videoFrames');
  await gameReady(device, 'auto-rebuy-popup');
  await capture('auto_rebuy');
  if (animationInfo) {
    await proxy.command('texas/ui', {});
    await proxy.command('android/auto-rebuy-hold', { hold: true });
    try {
      await gameTap(device, 'auto-rebuy-switch');
      await expect.poll(async () => (await proxy.command<{ requested: boolean }>('android/auto-rebuy-hold')).requested,
        { timeout: 5000 }).toBe(true);
      await animationInfo.attach('texas-loading-full', { body: await gameScreenshot(device), contentType: 'image/png' });
      // 两层图标分别旋转，逐区保存真实画面明暗/位置相位。
      const results = await Promise.allSettled([
        captureMovingKeyframes(device, 'texas-loading-spinner', animationInfo,
          [screenBounds(device, { x: 300, y: 550, width: 26, height: 50 }), screenBounds(device, { x: 338, y: 580, width: 42, height: 52 })]),
        setTimeout(1_500).then(() => proxy.command('android/auto-rebuy-hold', { hold: false })),
      ]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    } finally { await proxy.command('android/auto-rebuy-hold', { hold: false }); }
    await expect.poll(async () => (await gameReady(device, 'auto-rebuy-switch')).checked,
      { timeout: 30_000 }).toBe(true);
  }
  await animateGamePanel(device, 'texas-holdem', 'auto-rebuy', 'auto-rebuy-close-button',
    screenBounds(device, { x: 320, y: 430, width: 340, height: 400 }), animationInfo, 'exit', 'videoFrames');
  await gameGone(device, 'auto-rebuy-popup');
  await animateGamePanel(device, 'texas-holdem', 'pair-play-report', 'report-pair-play-button',
    screenBounds(device, { x: 200, y: 260, width: 440, height: 700 }), animationInfo);
  await gameReady(device, 'report-pair-play-reason-input');
  expect((await gameNodes(device)).filter(node => node.res === 'select-player-button')).toHaveLength(4);
  await dismissKeyboard(device);
  await capture('pair_play_report');
  await animateGamePanel(device, 'texas-holdem', 'pair-play-report', 'report-pair-play-close-button',
    screenBounds(device, { x: 200, y: 260, width: 440, height: 700 }), animationInfo, 'exit', 'videoFrames');
  await gameGone(device, 'report-pair-play-reason-input');
  await animateGamePanel(device, 'texas-holdem', 'personal-leaderboard', 'texas-holdem-leaderboard-button',
    screenBounds(device, { x: 200, y: 200, width: 400, height: 900 }), animationInfo, 'enter', 'motionFrames', [],
    async () => {
      await expect.poll(async () => (await gameReady(device, 'personal-leader-board-nickname')).text,
        { timeout: 30_000 }).toMatch(/\S/);
    });
  await texasEvents(context, [{ event: 'player_statistics', player_id: self,
    history_buy_in_amount: 1000, played_game_count: 10, settlement_net_amount: 180 }]);
  await gameReady(device, 'personal-leader-board-record-container');
  await expect.poll(async () => (await gameReady(device, 'personal-leader-board-round')).text,
    { timeout: 30_000 }).toMatch(/(?:^|\s)10$/);
  await capture('personal_leaderboard');
  await animateGamePanel(device, 'texas-holdem', 'personal-leaderboard', 'personal-leader-board-close-button',
    screenBounds(device, { x: 200, y: 200, width: 400, height: 900 }), animationInfo, 'exit');
  await gameGone(device, 'personal-leader-board-close-button');
  await texasEvents(context, [{ event: 'settlement', players: [{ player_id: REPLAY_PLAYER_IDS[0], net: 180, prize: 180, stack: 1140 }] }]);
  await gameReady(device, 'bet-next-hand-button');
  await capture('prediction');
  await texasEvents(context, [{ event: 'settlement_hand_prediction', result: { net: 10, currency_name: 'coin' } }]);
  await gameReady(device, 'bet-next-hand-result-amount', '+10');
  await capture('prediction_result');
  await texasEvents(context, [{ event: 'new_game', game_id: 'visual-fixed-game', settings: { small_blind: 1, big_blind: 2, ante: 0 } }]);
  await gameGone(device, 'bet-next-hand-button');
  await restoreTexas(context);
  if (animationInfo) await captureTimedLevelUp(device, 'texas-holdem', 'texas-holdem-operation-button-call', animationInfo);
  else {
    await gameTap(device, 'texas-holdem-operation-button-call');
    expect((await gameReady(device, 'level-up-title')).text).toContain('6');
    await capture('level_up');
    await gameTap(device, 'level-up-close-button');
  }
}

/**
 * 复用 Web 的大厅开关、多人举报选择、猜牌输赢和加时冷却分支。
 * @param context - 大厅展示夹具下的真实房间上下文。
 */
export async function texasHallVariants(context: TexasContext): Promise<void> {
  const { device, proxy, capture } = context;
  await restoreTexas(context);
  await proxy.command('texas/ui', {});
  await gameTap(device, 'auto-rebuy-button');
  await gameTap(device, 'auto-rebuy-switch');
  await expect.poll(async () => (await gameReady(device, 'auto-rebuy-switch')).checked,
    { timeout: 30_000 }).toBe(true);
  await gameGone(device, 'common-alert-container');
  await capture('auto_rebuy_enabled');
  await gameTap(device, 'auto-rebuy-close-button');
  await gameGone(device, 'auto-rebuy-popup');
  await gameTap(device, 'report-pair-play-button');
  await gameReady(device, 'report-pair-play-reason-input');
  await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'select-player-button').length,
    { timeout: 30_000 }).toBe(4);
  const players = (await gameNodes(device)).filter(node => node.res === 'select-player-button');
  expect(players).toHaveLength(4);
  for (const node of players.slice(0, 2)) {
    const { x, y, width, height } = node.bounds;
    await device.input.tap({ x: Number(String(Math.round(x + width / 2))), y: Number(String(Math.round(y + height / 2))) });
  }
  await device.fill({ res: 'report-pair-play-reason-input' }, 'Suspicious cooperation');
  const caret = await focusedCaretMask(device);
  expect(caret, '键盘可见时应检测到真实光标，不能遮掉整行文字').toBeDefined();
  await dismissKeyboard(device);
  const input = await device.info({ res: 'report-pair-play-reason-input' });
  expect(input.text).toBe('Suspicious cooperation');
  await capture('pair_play_selected', [translateCaret(caret!, input.bounds)]);
  await gameTap(device, 'report-pair-play-close-button');
  await gameGone(device, 'report-pair-play-reason-input');
  await texasEvents(context, [{ event: 'settlement', players: [{ player_id: REPLAY_PLAYER_IDS[0], net: 180, prize: 180, stack: 1140 }] }]);
  await gameTap(device, 'bet-next-hand-button');
  await gameReady(device, 'bet-next-hand-has-bet-icon');
  await gameReady(device, 'bet-next-hand-placeholder');
  await capture('prediction_bet');
  await texasEvents(context, [{ event: 'settlement_hand_prediction', result: { net: -10, currency_name: 'coin' } }]);
  await gameReady(device, 'bet-next-hand-result-amount', '-10');
  await capture('prediction_loss');
  await gameGone(device, 'bet-next-hand-result-amount');
  await texasEvents(context, [{ event: 'settlement_hand_prediction', result: { net: 20, currency_name: 'diamond' } }]);
  await gameReady(device, 'bet-next-hand-result-amount', '+20');
  await capture('prediction_diamond');
  await texasEvents(context, [{ event: 'new_game', game_id: 'visual-fixed-game', settings: { small_blind: 1, big_blind: 2, ante: 0 } }]);
  await restoreTexas(context);
  await enableGameSetting(device, 'operation-time');
  await gameTap(device, 'texas-holdem-delay-operation-button');
  await restoreTexas(context);
  await expect.poll(async () => gameTextWithin(await gameNodes(device), 'texas-holdem-delay-operation-button')
    .some(text => /^\d+:\d+$/.test(text)),
    { timeout: 30_000 }).toBe(true);
  await capture('delay_cooldown');
  await gameTap(device, 'texas-holdem-delay-operation-button');
  expect((await gameReady(device, 'common-alert-message')).text).toMatch(/冷却|冷卻|cool/i);
  await capture('delay_cooldown_alert');
}
