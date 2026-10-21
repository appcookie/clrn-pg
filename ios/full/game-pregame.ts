// 采集两种牌桌开局面板；录像内使用即时就绪查询，完整终点和动画门禁保持独立。
import { screenBounds } from './screen-geometry';
import type { NativeDevice as AndroidDevice } from './native-device';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import { gameTap as tap, gameTapCurrent, gameConnected, gameConnectedCurrent, gameReady, gameGone, gameGoneCurrent, gameNodes } from './game-controls';
import { animateGamePanel } from './game-panel-animation';
import presentation from '../../visual/fixtures/account-presentation.json' with { type: 'json' };
import { captureMovingKeyframes } from './loop-keyframes';
import { captureNativeTransition } from './animation-transition';
import { seatGuideMotionBounds } from './game-masks';
import { gameMaskPoint } from './game-mask-point';
import { nativeReviewPanelBounds, nativeChatPanelBounds } from './animation-region';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';


type Capture = (state: string) => Promise<void>;

/**
 * 打开与 Web 相同的牌桌菜单项，并等待原生面板就绪。
 * @param device - 专用模拟器连接。
 * @param item - 共用菜单标记。
 * @param ready - 面板就绪标记。
 */
export async function gameMenu(device: AndroidDevice, item: string, ready: string): Promise<void> {
  await tap(device, 'menu-button');
  await tap(device, `drawer-menu-item-${item}`);
  await gameGone(device, 'drawer-menu-item-exit');
  await gameReady(device, ready);
}

/**
 * 点击真实弹层遮罩的边缘，避免点击其中央内容。
 * @param device - 专用模拟器连接。
 * @param marker - 当前面板标记。
 */
async function gameMaskClosePoint(device: AndroidDevice, marker: string,
  maskMarker = 'screen-mask-touch-to-close'): Promise<{ x: number; y: number }> {
  const { bounds } = await gameReady(device, maskMarker);
  const panel = marker === 'in-game-chat-content-container'
    ? nativeChatPanelBounds(await device.nodes(), device.screenSize) : (await gameReady(device, marker)).bounds;
  return gameMaskPoint(bounds, panel, device.screenSize);
}

/** 点击已定位的遮罩空白处，并等待当前面板关闭。
 * @param device - 专用模拟器连接。
 * @param marker - 当前面板标记。
 */
export async function closeGameMask(device: AndroidDevice, marker: string,
  maskMarker = 'screen-mask-touch-to-close'): Promise<void> {
  const point = await gameMaskClosePoint(device, marker, maskMarker);
  await device.input.tap({ x: Number(String(Math.round(point!.x))), y: Number(String(Math.round(point!.y))) });
  await gameGone(device, marker);
}

/**
 * 通过真实遮罩关闭牌桌面板，并采样其退场帧。
 * @param device - 专用模拟器连接。
 * @param game - 当前玩法。
 * @param name - 面板名称。
 * @param marker - 当前面板标记。
 * @param region - 动画绘制范围。
 * @param testInfo - 英文动画关键帧报告。
 * @param masks - 与面板无关的动态区域。
 * @param samplingMethod - 短退场动画使用原生录屏取得足够的中途帧。
 */
export async function closeAnimatedGameMask(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua',
  name: string, marker: string, region: ScreenshotBounds, testInfo?: TestInfo,
  masks: ScreenshotMask[] = [], samplingMethod: 'motionFrames' | 'videoFrames' = game === 'zhajinhua'
    ? 'videoFrames' : 'motionFrames'): Promise<void> {
  if (!testInfo) { await closeGameMask(device, marker); return; }
  const point = await gameMaskClosePoint(device, marker);
  await captureNativeTransition(device, `${game}-${name}-exit`, testInfo, region,
    () => device.input.tap({ x: Number(String(Math.round(point.x))), y: Number(String(Math.round(point.y))) }),
    masks, [], 600, samplingMethod);
  await gameGone(device, marker);
}

/**
 * 共用两种玩法的开局前操作，严格按 Web 状态清单采集。
 * @param device - 专用模拟器连接。
 * @param game - 本轮玩法。
 * @param capture - 按共享状态名截图。
 * @param animationInfo - 英文原生动画关键帧基准；其他语言复用静态页面截图。
 * @param phase - 长开局前场景按房间阶段拆分时执行的部分。
 */
export async function gamePreGame(device: AndroidDevice, game: 'texas-holdem' | 'zhajinhua', capture: Capture,
  animationInfo?: TestInfo, phase: 'all' | 'first' | 'middle' | 'second' = 'all'): Promise<void> {
  await gameReady(device, game === 'texas-holdem' ? 'texas-holdem-room-name-text' : 'zhajinhua-text-room-name', 'TestRoom');
  /** 仅房间重连遮罩打断静态截图时重试同一状态，仍须通过原有逐像素断言。
   * @param state - 当前共用截图状态。
   */
  const captureConnected = async (state: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await gameConnected(device, 2_000);
      try { await capture(state); return; }
      catch (error) {
        const reconnecting = (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || ''));
        if (attempt || !reconnecting || !String(error).includes('页面像素必须保持稳定')) throw error;
      }
    }
  };
  if (phase !== 'second') {
    if (phase !== 'middle') {
      await capture('waiting_table');
      if (animationInfo) {
        const arrows = (await gameNodes(device)).filter(node => node.res?.startsWith('seat-guide-')
          && node.bounds.width > 0 && node.bounds.height > 0);
        expect(arrows, '九个空座箭头必须分别可见').toHaveLength(9);
        await captureMovingKeyframes(device, `${game}-seat-guides`, animationInfo,
          arrows.map(node => seatGuideMotionBounds(node.bounds)));
      }
      await animateGamePanel(device, game, 'drawer-menu', 'menu-button',
        screenBounds(device, { x: 120, y: 300, width: 180, height: 500 }), animationInfo, 'enter',
        game === 'zhajinhua' ? 'videoFrames' : 'motionFrames', [], undefined,
        game === 'texas-holdem' ? [
          'texas-holdem-drawer-menu-enter-early-phase.png',
          'texas-holdem-drawer-menu-enter-late-phase.png',
        ] : []);
      await gameReady(device, 'drawer-menu-item-exit');
      await capture('menu');
      await animateGamePanel(device, game, 'card-rank', 'drawer-menu-item-card_rank',
        screenBounds(device, { x: 110, y: 400, width: 440, height: 600 }), animationInfo, 'enter', 'videoFrames');
      await gameReady(device, 'card-rank-list');
      await captureConnected('card_rank');
      if ((await gameNodes(device)).some(node => node.res === 'card-rank-popup-close')) {
        await animateGamePanel(device, game, 'card-rank', 'card-rank-popup-close',
          screenBounds(device, { x: 110, y: 400, width: 440, height: 600 }), animationInfo, 'exit', 'videoFrames', [], undefined,
          game === 'texas-holdem' ? ['texas-holdem-card-rank-exit-late-phase.png'] : []);
      }
      else await closeAnimatedGameMask(device, game, 'card-rank', 'card-rank-list',
        screenBounds(device, { x: 110, y: 400, width: 440, height: 600 }), animationInfo);
      // 德州牌型说明后的房间重连偶尔持续不恢复；后续面板用新建的独立房间采样。
      if (game === 'texas-holdem' && phase === 'first') return;
      if (game === 'zhajinhua') {
        await tap(device, 'menu-button');
        await animateGamePanel(device, game, 'game-rule', 'drawer-menu-item-game_rule',
          screenBounds(device, { x: 130, y: 330, width: 460, height: 610 }), animationInfo);
        await gameReady(device, 'game-rule-popup');
        await animateGamePanel(device, game, 'game-rule', 'game-rule-popup-close-button',
          screenBounds(device, { x: 130, y: 330, width: 460, height: 610 }), animationInfo, 'exit', 'videoFrames', [], async () => {
            // 背景房间连接提示可能在面板退场后出现；终点须等它确实消失。
            await setTimeout(1_000);
            await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
              { timeout: 30_000 }).toBe(false);
          });
        await gameGone(device, 'game-rule-popup');
      }
      // 拼三张首组在规则出入场后结束；主题、设置、买入及续费由独立中组
      // 完整执行，避免13次原片处理累计超过单例90分钟预算。
      if (phase === 'first') return;
    }
    for (const [state, ready, close] of [
      ['theme', 'game-settings-card-theme-simple', 'game-settings-close-button'],
      ['settings', 'game-settings-popup-container', 'game-settings-close-button'],
      ['buy_in', 'buy-in-title', 'buy-in-close-button'],
      ['renew', 'renew-popup-close-button', 'renew-popup-close-button'],
    ]) {
      // 重连遮罩会短暂盖住菜单按钮；等真实牌桌恢复后再点击下一项。
      await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
        { timeout: 45_000 }).toBe(false);
      await tap(device, 'menu-button');
      await gameReady(device, `drawer-menu-item-${state}`);
      const renewalReady = state === 'renew' && animationInfo ? async () => {
        await expect.poll(async () => (await gameReady(device, 'renew-popup-remain-diamond')).text?.trim(),
          { timeout: 45_000 }).toBe(presentation.balance);
        await expect.poll(async () => Number((await gameReady(device, 'renew-popup-spend-diamond')).text?.trim()),
          { timeout: 45_000 }).toBeGreaterThan(0);
      } : undefined;
      await animateGamePanel(device, game, state, `drawer-menu-item-${state}`,
        screenBounds(device, { x: 110, y: 360, width: 480, height: 500 }), animationInfo, 'enter',
        game === 'zhajinhua' || (game === 'texas-holdem' && ['theme', 'buy_in'].includes(state))
          ? 'videoFrames' : 'motionFrames', [], renewalReady);
      await gameGone(device, 'drawer-menu-item-exit');
      await gameReady(device, ready);
      if (state === 'renew') {
        // 关闭按钮先于异步余额和续费价格出现，初始的两个 0 不能作为业务就绪。
        await expect.poll(async () => (await gameReady(device, 'renew-popup-remain-diamond')).text?.trim(),
          { timeout: 45_000 }).toBe(presentation.balance);
        await expect.poll(async () => Number((await gameReady(device, 'renew-popup-spend-diamond')).text?.trim()),
          { timeout: 45_000 }).toBeGreaterThan(0);
      }
      await captureConnected(state);
      const exitReady = game === 'zhajinhua' && state === 'buy_in' && animationInfo ? async () => {
        // 房间重连提示会独立于买入面板入退场；终点等其消失后再与牌桌基准比较。
        await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
          { timeout: 45_000 }).toBe(false);
      } : undefined;
      await animateGamePanel(device, game, state, close,
        screenBounds(device, { x: 110, y: 360, width: 480, height: 500 }), animationInfo, 'exit',
        game === 'zhajinhua' || (game === 'texas-holdem' && state === 'settings')
          ? 'videoFrames' : 'motionFrames', [], exitReady);
      await gameGone(device, ready);
    }
    if (game === 'zhajinhua') {
      // 续费面板结束后房间可能独立重连；排行榜起点必须是稳定牌桌。
      await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
        { timeout: 45_000 }).toBe(false);
      await setTimeout(1_000);
      await expect.poll(async () => (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || '')),
        { timeout: 45_000 }).toBe(false);
    }
    if (phase === 'middle') return;
  }
  await animateGamePanel(device, game, 'leaderboard',
    game === 'texas-holdem' ? 'texas-holdem-leaderboard-button' : 'zhajinhua-learder-borard-button',
    screenBounds(device, { x: 110, y: 400, width: 470, height: 450 }), animationInfo);
  await gameReady(device, 'public-leader-board-empty');
  await gameGone(device, 'public-leader-board-loading');
  await capture('leaderboard');
  await closeAnimatedGameMask(device, game, 'leaderboard', 'public-leader-board-container',
    screenBounds(device, { x: 110, y: 400, width: 470, height: 450 }), animationInfo);
  await animateGamePanel(device, game, 'game-record', 'game-record-button',
    screenBounds(device, { x: 150, y: 400, width: 440, height: 450 }), animationInfo, 'enter', 'videoFrames', [],
    async () => { await gameReady(device, 'review-board-description-text'); });
  await gameReady(device, 'review-board-description-text');
  await capture('game_record');
  // 战绩从右侧展开；说明文字只占面板中间，不能用其边界判断遮罩位置。
  await gameReady(device, 'screen-mask-touch-to-close');
  const reviewPanel = nativeReviewPanelBounds(await device.nodes(), device.screenSize);
  /** 确认后台房间连接稳定，再点击侧栏外遮罩触发一次真实侧滑退出。 */
  const closeRecord = async () => {
    await gameConnectedCurrent(device, 2_000);
    // 录屏预热与连接等待后重新观测遮罩，不能沿用数十秒前的点击条件。
    await gameTapCurrent(device, 'screen-mask-touch-to-close', mask =>
      gameMaskPoint(mask, reviewPanel, device.screenSize));
  };
  if (animationInfo) await captureNativeTransition(device, `${game}-game-record-exit`, animationInfo,
    screenBounds(device, { x: 150, y: 400, width: 440, height: 450 }), closeRecord, [], [], 0,
    game === 'zhajinhua' ? 'videoFrames' : 'motionFrames', undefined, async () => {
      // 39574774993 的原片末帧仍在重连，解码后截图已恢复；必须在同一次
      // 录屏内等到真实终态，不能丢弃末帧或把 Connecting 遮罩排除比较。
      // 39587639168的整树查询把退场录成74秒/1806帧，解码超过3分钟。
      // 同次原生元素查询只观察目标与连接提示，保留关闭和持续就绪条件。
      await gameGoneCurrent(device, 'review-board-description-text');
      await gameConnectedCurrent(device, 2_000);
    });
  else await closeRecord();
  await gameGone(device, 'review-board-description-text');
  await animateGamePanel(device, game, 'chat', `${game}-chat-button`,
    screenBounds(device, { x: 110, y: 860, width: 140, height: 310 }), animationInfo, 'enter', 'videoFrames');
  // 长时间原片分析后房间可能正在独立重连；39572958229 的聊天仍挂载，
  // 但 Connecting 遮罩使全部聊天控件不可见。先等待连接恢复再验证静态面板。
  await gameConnected(device, 2_000);
  await gameReady(device, 'in-game-chat-content-container');
  await capture('chat');
  const chatPoint = await gameMaskClosePoint(device, 'in-game-chat-content-container', 'in-game-chat-mask');
  /** 点击聊天抽屉外的真实遮罩。 */
  const closeChat = () => device.input.tap(chatPoint);
  if (animationInfo) await captureNativeTransition(device, `${game}-chat-exit`, animationInfo,
    screenBounds(device, { x: 110, y: 760, width: 140, height: 500 }), closeChat, [], [], 0, 'videoFrames');
  else await closeChat();
  await gameGone(device, 'in-game-chat-content-container');
  // 聊天抽屉退场后房间偶尔独立重连；下一段动画的起点必须是无遮挡的真实牌桌。
  await gameConnected(device, 2_000);
  await animateGamePanel(device, game, 'buy-in-applications', 'buy-in-application-button',
    screenBounds(device, { x: 110, y: 400, width: 470, height: 450 }), animationInfo, 'enter',
    game === 'zhajinhua' ? 'videoFrames' : 'motionFrames', [], undefined,
    game === 'zhajinhua' ? ['zhajinhua-buy-in-applications-enter-middle-alternate.png'] : []);
  await gameReady(device, 'buy-in-application-no-requests');
  await capture('buy_in_applications');
  await closeAnimatedGameMask(device, game, 'buy-in-applications', 'buy-in-application-list',
    screenBounds(device, { x: 110, y: 400, width: 470, height: 450 }), animationInfo);
  if (game === 'texas-holdem') return;
  await captureGameThemes(device, capture);
}

/**
 * 两种玩法共用卡牌主题、牌桌背景和开关操作，维持同样的原生验证。
 * @param device - 专用模拟器连接。
 * @param capture - 当前玩法的共享状态截图入口。
 */
export async function captureGameThemes(device: AndroidDevice, capture: Capture): Promise<void> {
  await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
  for (const theme of ['four-color', 'four-color-two', 'realistic']) {
    await tap(device, `game-settings-card-theme-${theme}`);
    await capture(`theme_${theme.replaceAll('-', '_')}`);
  }
  await tap(device, 'game-settings-card-theme-simple');
  await tap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-card-theme-simple');
  for (const background of ['blue', 'purple', 'black']) {
    await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
    await tap(device, `game-settings-background-${background}`);
    await tap(device, 'game-settings-close-button');
    await gameGone(device, 'game-settings-card-theme-simple');
    await capture(`table_${background}`);
  }
  await gameMenu(device, 'theme', 'game-settings-card-theme-simple');
  await tap(device, 'game-settings-background-green');
  await tap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-card-theme-simple');
  await gameMenu(device, 'settings', 'game-settings-popup-container');
  let count = 0;
  for (const name of ['sound-effect', 'vibrate', 'player-voice', 'show-card', 'operation-time', 'see-remain-card', 'shake-avatar']) {
    const selector = { res: `game-settings-switch-${name}` };
    if (!(await gameNodes(device)).some(node => node.res === selector.res)) continue;
    // 39663522184 的震动开关仍显示 off：先点击真实开关左侧滑块。
    // 39686222283 的最后一个开关在两次左侧点击后仍 off；只有再次
    // 确认状态仍 off，第二次才改点同一开关右半侧。
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await gameConnected(device, 2_000);
      if ((await gameReady(device, selector.res)).checked) break;
      await tap(device, selector.res, false, undefined, undefined, bounds => ({
        x: Math.round(bounds.x + (attempt ? bounds.width - bounds.height / 2 : bounds.height / 2)),
        y: Math.round(bounds.y + bounds.height / 2),
      }));
      try {
        await expect.poll(async () => (await gameReady(device, selector.res)).checked,
          { timeout: 12_000 }).toBe(true);
        break;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
    await expect.poll(async () => (await gameReady(device, selector.res)).checked,
      { timeout: 30_000 }).toBe(true);
    count++;
  }
  expect(count).toBeGreaterThanOrEqual(4);
  await capture('settings_enabled');
}
