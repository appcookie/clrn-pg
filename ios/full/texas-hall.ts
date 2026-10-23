import { screenBounds } from './screen-geometry';
import { expect } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { REPLAY_PLAYER_IDS } from '../../visual/cases/texas-holdem/replayData';
import { gameConnected, gameGone, gameNodes, gameReady, gameScreenshot, gameTap, gameTapCurrent, gameTextWithin } from './game-controls';
import { closeGameMask } from './game-pregame';
import { dismissKeyboard } from './keyboard';
import { focusedCaretMask } from './screenshot';
import { translateCaret } from './caret-mask';
import { enableGameSetting, restoreTexas, texasEvents, type TexasContext } from './texas-support';
import { animateGamePanel, captureTimedLevelUp } from './game-panel-animation';
import { captureMovingKeyframes } from './loop-keyframes';
import accountPresentation from '../../visual/fixtures/account-presentation.json' with { type: 'json' };
import { recordScreenSamples } from './video-frames';
import { gameLoadingRegions } from './game-loading-region';
import { triggerPredictionResult } from './prediction-result';
import { loadingWindow } from './loading-window';
import { MissingLeaderboardSlideError } from './personal-leaderboard-slide';
import { capturePanelWithMotionRecaptures } from './recapture-panel';
import type { NativeLayoutNode } from './native-device';
import type { TestInfo } from '@playwright/test';
import { animationRecordOnly } from './record-only';

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
  await gameTapCurrent(device, 'menu-button');
  // Run 39805489332 returned from a real menu tap, but the drawer never
  // mounted: the failure screen and native tree still showed the closed table.
  // Recheck the resulting UI before a second tap, so a slow 300 ms entrance
  // cannot accidentally be toggled closed again.
  if (!(await gameNodes(device)).some(node => node.res === 'drawer-menu-item-exit')) {
    await delay(1_000);
    const settled = await gameNodes(device);
    if (!settled.some(node => node.res === 'drawer-menu-item-exit')) {
      expect(settled.some(node => node.res === 'menu-button' && node.visible !== false),
        '菜单未打开时，牌桌菜单按钮仍须可见').toBe(true);
      expect(settled.some(node => /Connecting\.\.\./.test(node.text || '')),
        '菜单未打开时，牌桌不能处于重连遮挡').toBe(false);
      await animationInfo?.attach('texas-hall-menu-first-tap-unopened', {
        body: JSON.stringify({ menu: settled.find(node => node.res === 'menu-button'),
          drawerMounted: false }), contentType: 'application/json',
      });
      await gameTapCurrent(device, 'menu-button');
    }
  }
  await gameReady(device, 'drawer-menu-item-exit');
  await capture('hall_menu');
  await closeGameMask(device, 'drawer-menu-item-exit');
  await animateGamePanel(device, 'texas-holdem', 'auto-rebuy', 'auto-rebuy-button',
    screenBounds(device, { x: 320, y: 430, width: 340, height: 400 }), animationInfo, 'enter', 'videoFrames');
  await gameReady(device, 'auto-rebuy-popup');
  await capture('auto_rebuy');
  if (animationInfo && animationRecordOnly) {
    await recordScreenSamples(device, 'texas-loading-spinner', animationInfo,
      () => gameTapCurrent(device, 'auto-rebuy-switch'));
    await expect.poll(async () => (await gameReady(device, 'auto-rebuy-switch')).checked,
      { timeout: 30_000 }).toBe(true);
  } else if (animationInfo) {
    await proxy.command('texas/ui', {});
    await proxy.command('android/auto-rebuy-hold', { hold: true });
    let switchTap: Promise<void> | undefined;
    try {
      // Full and targeted WDA tree queries both stalled while simctl recorded
      // (39670806561, 39680532040). Establish one real stable target before
      // recording; the popup stays mounted until the switch is tapped once.
      await gameConnected(device, 1_000);
      const firstSwitch = await gameReady(device, 'auto-rebuy-switch');
      const currentSwitch = await gameReady(device, 'auto-rebuy-switch');
      expect(currentSwitch.bounds).toEqual(firstSwitch.bounds);
      expect(currentSwitch.enabled).toBe(true);
      expect(currentSwitch.checked).toBe(false);
      const switchPoint = { x: Math.round(currentSwitch.bounds.x + currentSwitch.bounds.width / 2),
        y: Math.round(currentSwitch.bounds.y + currentSwitch.bounds.height / 2) };
      const beforeLoading = await gameScreenshot(device);
      let regions!: ReturnType<typeof gameLoadingRegions>, loadingLayout!: NativeLayoutNode[], loaded!: Buffer;
      // 39695625593 的 simctl 原片在 23 秒墙钟内只编码了 4 秒，
      // 39702206750 中同一路径下的原生点击也未触发请求。让 XCTest
      // 录屏和原生点击走同一驱动，并确认点击已完成再等待实际请求。
      const recorded = await recordScreenSamples(device, 'texas-loading-spinner', animationInfo, async () => {
        // Use the verified current target for one native tap, without another
        // potentially stalled accessibility snapshot during recording.
        switchTap = device.input.tap(switchPoint);
        await switchTap;
        // 39819950690: WDA returned from mobile: tap, but the real switch
        // remained unchecked and no request arrived. A second action is safe
        // only after observing that unchanged native control and popup.
        let requested = false;
        for (let attempt = 0; attempt < 10 && !requested; attempt++) {
          requested = (await proxy.command<{ requested: boolean }>('android/auto-rebuy-hold')).requested;
          if (!requested) await delay(500);
        }
        if (!requested) {
          const settled = await gameNodes(device);
          const actualSwitch = settled.find(node => node.res === 'auto-rebuy-switch' && node.visible !== false);
          expect(settled.some(node => node.res === 'auto-rebuy-popup' && node.visible !== false),
            '重试开关前自动带入面板必须仍可见').toBe(true);
          expect(settled.some(node => /Connecting\.\.\./.test(node.text || '')),
            '重试开关前牌桌不能处于重连遮挡').toBe(false);
          expect(actualSwitch?.bounds, '重试开关前必须是同一个原生控件').toEqual(currentSwitch.bounds);
          expect(actualSwitch?.enabled).toBe(true);
          await animationInfo.attach('texas-loading-first-tap-state', {
            body: JSON.stringify({ requested, switch: actualSwitch,
              popupMounted: true }), contentType: 'application/json',
          });
          if (actualSwitch?.checked === false) {
            switchTap = device.driver.tap('auto-rebuy-switch');
            await switchTap;
          }
        }
        // The native action can still return before the game sends its request.
        // Require one real request, then finish capture before the app's 10s
        // HTTP deadline; the proxy's longer hold limit is only a fail-safe.
        await expect.poll(async () => (await proxy.command<{ requested: boolean }>('android/auto-rebuy-hold')).requested,
          { timeout: 20_000 }).toBe(true);
        // The held PUT has a 10-second client deadline. The Simulator PNG
        // capture is independent of WDA's source query, so collect both at
        // once instead of spending their latencies in sequence. The native
        // endpoint and geometry still come from this same visible Loading.
        [loadingLayout, loaded] = await Promise.all([
          device.layoutNodes(), gameScreenshot(device),
        ]);
        // The original movie must retain Loading through its final frame.
        // Release immediately after recording stops, before MOV attachment.
      }, 0,
        async () => { await proxy.command('android/auto-rebuy-hold', { hold: false }); }, 20, 'xctest');
      await animationInfo.attach('texas-loading-native-layout', {
        body: JSON.stringify(loadingLayout), contentType: 'application/json',
      });
      await animationInfo.attach('texas-loading-independent-endpoint', {
        body: loaded, contentType: 'image/png',
      });
      regions = gameLoadingRegions(loadingLayout, device.screenSize);
      const flatten = (node: NativeLayoutNode): NativeLayoutNode[] => [node, ...node.children.flatMap(flatten)];
      const labels = loadingLayout.flatMap(flatten).filter(node => node.res === 'Loading'
        && node.clazz === 'XCUIElementTypeStaticText');
      const bounds = [...new Map(labels.map(node => [JSON.stringify(node.bounds), node.bounds])).values()];
      expect(bounds, '英文原生加载文字必须具有唯一位置').toHaveLength(1);
      const window = await loadingWindow(recorded, beforeLoading, loaded, bounds[0]);
      const samples = window.frames;
      await animationInfo.attach('texas-loading-window', { body: JSON.stringify({ first: window.first,
        label: bounds[0], timestampsMs: samples.map(frame => frame.capturedAt) }), contentType: 'application/json' });
      await animationInfo.attach('texas-loading-regions', { body: JSON.stringify(regions), contentType: 'application/json' });
      await animationInfo.attach('texas-loading-full', { body: Buffer.from(samples[0].png, 'base64'), contentType: 'image/png' });
      await captureMovingKeyframes(device, 'texas-loading-ring', animationInfo, [regions.ring],
        18, undefined, 1, [], samples, regions.ringMasks);
      await captureMovingKeyframes(device, 'texas-loading-spade', animationInfo, [regions.spade],
        18, undefined, 1, [], samples);
    } finally {
      await proxy.command('android/auto-rebuy-hold', { hold: false });
      await switchTap;
    }
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
  const openPersonalLeaderboard = (info?: TestInfo) => animateGamePanel(device, 'texas-holdem',
    'personal-leaderboard', 'texas-holdem-leaderboard-button',
    screenBounds(device, { x: 200, y: 200, width: 400, height: 900 }), info, 'enter', 'motionFrames', [],
    async () => {
      // Run 39540787548 painted the real nickname by 15s, but full-tree
      // readiness polling still timed out with an empty value.
      // Query this unique displayed native label; the complete endpoint and
      // statistics still receive their independent checks after recording.
      await expect.poll(async () => (await device.transientMarker('personal-leader-board-nickname'))?.text,
        { timeout: 30_000 }).toBe(accountPresentation.nickname);
    });
  if (animationInfo && !animationRecordOnly) {
    // XCTest sometimes encodes no frames during the 300 ms sidebar slide
    // (39851785925: 0 -> 6.128 s, then only complete-panel frames). A fresh
    // real close/open action is allowed solely for missing video motion. All
    // recordings remain in the report; one original movie must still pass
    // every unchanged slide, endpoint, and business assertion.
    await capturePanelWithMotionRecaptures(animationInfo, openPersonalLeaderboard, async () => {
      await gameTap(device, 'personal-leader-board-close-button');
      await gameGone(device, 'personal-leader-board-close-button');
    }, error => error instanceof MissingLeaderboardSlideError);
  } else await openPersonalLeaderboard();
  await texasEvents(context, [{ event: 'player_statistics', player_id: self,
    history_buy_in_amount: 1000, played_game_count: 10, settlement_net_amount: 180 }]);
  await expect.poll(async () => {
    const nodes = await gameNodes(device);
    return ['buy-in', 'round', 'profit'].map(field => nodes
      .find(node => node.res === `personal-leader-board-${field}`)?.text?.match(/(?:^|\s)(-?\d+)$/)?.[1]);
  }, { timeout: 30_000 }).toEqual(['1000', '10', '180']);
  await capture('personal_leaderboard');
  await animateGamePanel(device, 'texas-holdem', 'personal-leaderboard', 'personal-leader-board-close-button',
    screenBounds(device, { x: 200, y: 200, width: 400, height: 900 }), animationInfo, 'exit');
  await gameGone(device, 'personal-leader-board-close-button');
  await texasEvents(context, [{ event: 'settlement', players: [{ player_id: REPLAY_PLAYER_IDS[0], net: 180, prize: 180, stack: 1140 }] }]);
  await gameReady(device, 'bet-next-hand-button');
  await capture('prediction');
  await capture('prediction_result', [], () => triggerPredictionResult(context));
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
