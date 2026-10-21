import { safeNativeTree } from './diagnostics';
import type { NativeDevice as AndroidDevice } from './native-device';
import presentation from '../../visual/fixtures/game-presentation.json' with { type: 'json' };
import type { TestInfo } from '@playwright/test';
import { compareScreenshot } from './device';
import { gameNodes, gameReady, gameMarker, gameScreenshot } from './game-controls';
import { expect } from '@playwright/test';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { foregroundPanels, visibleMasks, networkStatusMask, countdownMask, screenshotMaskNodes, seatGuideMotionBounds, leaderboardRoomIdentityMask } from './game-masks';
import { captureToast } from './game-transient';
import { captureChallengeAnimation } from './game-animation';
import { verifyLoopAnimation } from './loop-animation';
import { captureMovingKeyframes } from './loop-keyframes';
import { stableNativeObservation } from './native-stability';
import { playerCountdownNodes } from './game-countdown';
import { modalBackgroundMasks } from './modal-background-masks';
import { texasRaiseClockMasks } from './texas-raise-masks';
import { requirePredictionResult } from './prediction-result';

/**
 * 使原生控件边界及绘制余量落到实际截图的整数像素。
 * @param bounds - 原生控件边界。
 */
function pixelBounds(bounds: ScreenshotBounds): ScreenshotBounds {
  const x = Math.floor(bounds.x), y = Math.floor(bounds.y);
  return { x, y, width: Math.ceil(bounds.x + bounds.width) - x,
    height: Math.ceil(bounds.y + bounds.height) - y };
}

/**
 * 保留真实牌桌布局，仅遮罩网络延迟、倒计时和循环座位指示箭头等动态区域。
 * @param device - 专用模拟器连接。
 * @param name - 共享场景与状态生成的截图名。
 * @param testInfo - 当前测试报告。
 * @param transientMarker - 仅用于会自动消失的提示，截图前后都必须实际存在。
 * @param expectedAlertMarker - 错误分支已断言内容后，允许截图的特定业务弹窗按钮。
 * @param inputMasks - 已根据真实输入框位移校准的光标区域。
 * @param triggerToast - 短时提示或猜牌中奖结果，在背景遮罩准备后仅触发一次。
 */
export async function captureGame(device: AndroidDevice, name: string, testInfo: TestInfo, transientMarker?: string,
  expectedAlertMarker?: string, inputMasks: ScreenshotMask[] = [], triggerToast?: () => Promise<string | void>): Promise<void> {
  const preparedPrediction = transientMarker === 'bet-next-hand-result-amount'
    && /^(?:en|zh-Hans|zh-Hant)-signed-in-texas-hall-prediction-result$/.test(name);
  if (triggerToast && transientMarker !== 'toastText1' && !preparedPrediction) {
    throw new Error('提前准备遮罩仅用于短时文字提示或已指定的猜牌中奖结果。');
  }
  if (expectedAlertMarker) await gameReady(device, expectedAlertMarker);
  let nodes = await gameNodes(device);
  if ((!transientMarker || transientMarker === 'level-up-title') && foregroundPanels(nodes, device.screenSize).length) {
    nodes = await stableNativeObservation(() => gameNodes(device), (before, current) => {
      expect(foregroundPanels(current, device.screenSize).map(node => node.bounds),
        '前景面板边界须完成转场后再裁剪背景遮罩')
        .toEqual(foregroundPanels(before, device.screenSize).map(node => node.bounds));
    }, { initial: nodes, timeout: 30_000, interval: 300 });
  }
  if (expectedAlertMarker) expect(nodes.some(node => node.res === expectedAlertMarker), '目标业务提示必须可见').toBe(true);
  expect(nodes.some(node => node.res === 'XCUIElementTypeAlert' || (!expectedAlertMarker && node.res === 'common-alert-message')),
    '截图前不能存在意外错误提示').toBe(false);
  const backgroundMasks = [...modalBackgroundMasks(nodes, device.screenSize),
    ...(/-signed-in-texas-game-raise$/.test(name) ? texasRaiseClockMasks(nodes, device.screenSize) : [])];
  const masks: ScreenshotMask[] = [...inputMasks, ...backgroundMasks];
  const panels = foregroundPanels(nodes, device.screenSize);
  await testInfo.attach(`${name}-native-tree`, { body: JSON.stringify(safeNativeTree(nodes)), contentType: 'application/json' });
  const countdownNodes = playerCountdownNodes(nodes, name.includes('-zhajinhua-') ? 'zhajinhua' : 'texas-holdem');
  for (const node of new Set([...screenshotMaskNodes(nodes), ...countdownNodes])) {
    /**
     * 只排除仍可见的动态内容，保留覆盖其上的真实弹窗。
     * @param mask - 当前动态控件的范围。
     */
    const add = (mask: ScreenshotMask) => masks.push(...visibleMasks(mask, node, panels));
    if (['texas-holdem-room-id-text', 'zhajinhua-room-id-text'].includes(node.res || '')) {
      expect(node.text, '房号展示应与 Web 共用夹具一致').toBe(presentation.roomNumber);
      continue;
    }
    if (/^seat-guide-\d+$/.test(node.res || '')) {
      // 根据实际箭头宽度留出一轮上下移动范围，不使用 Android 固定像素补偿。
      add({ ...seatGuideMotionBounds(node.bounds),
        reason: `${node.res} 完整箭头动画范围` });
      continue;
    }
    if (/^(texas-holdem|zhajinhua)-active-countdown$/.test(node.res || '') || node.res === 'seat-progress-pie') {
      // API 35 控件边界向下取整；实测相邻帧在右侧两像素仍有倒计时填充变化。
      add({ x: node.bounds.x - 2, y: node.bounds.y - 2,
        width: node.bounds.width + 4, height: node.bounds.height + 4,
        reason: `${node.res} 含两像素绘制边缘` });
      continue;
    }
    if (node.res === 'leader-board-room-id') {
      add(leaderboardRoomIdentityMask(node, device.screenSize));
      continue;
    }
    if (node.res === 'view-community-cards-countdown') {
      add(countdownMask(node.bounds, node.text || ''));
      continue;
    }
    if (node.res === 'game-network-proxy-code'
      || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(node.text || '')
      || (node.res === 'countdown_timer_text' && /^\d+s$/.test(node.text || ''))
      || node.res === 'player-profile-id'
      || (!node.res && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(node.text || ''))) {
      // 玩家 ID 是透明语义标记；不能因它覆盖头像而把整个头像排除。
      add({ ...node.bounds, reason: node.res || (node.text?.includes(':') ? '保座或加时冷却倒计时' : '本轮真实房间 UUID') });
    }
    if (node.res === 'ping-screen-container') add(networkStatusMask(node.bounds));
  }
  if (name.endsWith('-zhajinhua-game-challenge-select')) {
    await captureChallengeAnimation(device, name, testInfo, masks);
    return;
  }
  if (name.endsWith('-pre-game-waiting-table')) {
    const guides = masks.filter(mask => /^seat-guide-\d+ 完整箭头动画范围$/.test(mask.reason));
    expect(guides.length, '等待开局的空座引导箭头必须可见').toBeGreaterThan(0);
    await verifyLoopAnimation(device, name, testInfo, guides.map(pixelBounds), masks);
  }
  if (/-signed-in-(?:texas|zhajinhua)-game-opponent-turn$/.test(name)) {
    const countdown = countdownNodes;
    expect(countdown, '对手行动时必须出现原生倒计时').toHaveLength(1);
    const regions = countdown.map(node => pixelBounds({ x: node.bounds.x - 2, y: node.bounds.y - 2,
      width: node.bounds.width + 4, height: node.bounds.height + 4 }));
    await verifyLoopAnimation(device, name, testInfo, regions, masks);
    if (name.startsWith('en-')) await captureMovingKeyframes(device, `${name}-countdown`, testInfo, regions);
  }
  if (triggerToast) {
    if (!preparedPrediction) await device.prepareTransientCapture();
    const expectedText = await triggerToast();
    if (preparedPrediction) {
      expect(expectedText, '猜牌中奖夹具必须明确要求真实 +10').toBe('+10');
      // The native app hides this result after 3000ms. Prepare the full tree
      // before sending its single event, then only query the displayed amount.
      // Every screenshot retains the existing before/after and stability gates.
      const observations: object[] = [];
      try {
        await expect.poll(async () => (await device.transientMarker('bet-next-hand-result-amount'))?.text,
          { timeout: 3000, intervals: [40] }).toBe('+10');
        await compareScreenshot(device, name, testInfo, masks,
          async () => { observations.push(await requirePredictionResult(device, masks)); },
          () => gameScreenshot(device), [], backgroundMasks);
      } finally {
        await testInfo.attach(`${name}-transient-observations`, {
          body: JSON.stringify(observations), contentType: 'application/json',
        });
      }
      return;
    }
    await captureToast(device, name, testInfo, masks, expectedText || undefined);
    return;
  }
  /** 不允许把提示消失后的稳定页面当成提示截图。 */
  const assertTransient = async () => {
    expect((await gameMarker(device, transientMarker!))?.text,
      `${transientMarker} 必须在截图前后可见`).toBeTruthy();
  };
  await compareScreenshot(device, name, testInfo, masks, transientMarker ? assertTransient : undefined,
    transientMarker ? () => gameScreenshot(device) : undefined, [], backgroundMasks);
}
