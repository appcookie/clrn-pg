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
import { capturePredictionResult } from './prediction-result';

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
  expectedAlertMarker?: string, inputMasks: ScreenshotMask[] = [], triggerToast?: () => Promise<string | void>,
  predictionCapture: typeof capturePredictionResult = capturePredictionResult): Promise<void> {
  const preparedPrediction = transientMarker === 'bet-next-hand-result-amount'
    && /^(?:en|zh-Hans|zh-Hant)-signed-in-texas-hall-prediction-result$/.test(name);
  if (triggerToast && transientMarker !== 'toastText1' && !preparedPrediction) {
    throw new Error('提前准备遮罩仅用于短时文字提示或已指定的猜牌中奖结果。');
  }
  if (expectedAlertMarker) await gameReady(device, expectedAlertMarker);
  let nodes = await gameNodes(device);
  if ((!transientMarker || transientMarker === 'level-up-title') && foregroundPanels(nodes, device.screenSize).length) {
    // 记录同一轮实际观测的标识和边界，区分动画位移与无障碍可见性变化；
    // 仅保留固定控件标识，不输出文本、输入值或完整原始属性。
    const observedPanels = (snapshot: typeof nodes) => foregroundPanels(snapshot, device.screenSize)
      .map(node => ({ marker: /^(?:texas-holdem-player-action-|texas-holdem-shortcut-raise-button-|zhajinhua-shortcut-raise-)/
        .test(node.res || '') ? node.res : '[container]', bounds: node.bounds, visible: node.visible }));
    const observations = [{ utc: new Date().toISOString(), panels: observedPanels(nodes) }];
    try {
      nodes = await stableNativeObservation(async () => {
        const current = await gameNodes(device);
        observations.push({ utc: new Date().toISOString(), panels: observedPanels(current) });
        return current;
      }, (before, current) => {
        expect(foregroundPanels(current, device.screenSize).map(node => node.bounds),
          '前景面板边界须完成转场后再裁剪背景遮罩')
          .toEqual(foregroundPanels(before, device.screenSize).map(node => node.bounds));
      }, { initial: nodes, timeout: 30_000, interval: 300 });
    } finally {
      await testInfo.attach(`${name}-foreground-observations`, {
        body: JSON.stringify(observations), contentType: 'application/json',
      });
    }
  }
  if (expectedAlertMarker) expect(nodes.some(node => node.res === expectedAlertMarker), '目标业务提示必须可见').toBe(true);
  expect(nodes.some(node => node.res === 'XCUIElementTypeAlert' || (!expectedAlertMarker && node.res === 'common-alert-message')),
    '截图前不能存在意外错误提示').toBe(false);
  const backgroundMasks = [...modalBackgroundMasks(nodes, device.screenSize),
    ...(/-signed-in-texas-game-raise$/.test(name) ? texasRaiseClockMasks(nodes, device.screenSize) : [])];
  // 39695657156: the real next-turn event removes our operation buttons but
  // may highlight Player1 while the completed quick raise is photographed.
  // Exclude only that unrelated, native-located opponent turn from baseline
  // comparison; keep the original unmasked PNG and all own raise/hand pixels.
  const nextTurn = name.endsWith('-signed-in-zhajinhua-game-quick-raise')
    ? nodes.find(node => /^zhajinhua-player-container-.*-operating$/.test(node.res || '')) : undefined;
  const nextTurnExclusions = nextTurn ? [{
    x: Math.max(0, nextTurn.bounds.x - 50), y: Math.max(0, nextTurn.bounds.y - 26),
    width: Math.min(device.screenSize.width, nextTurn.bounds.x + nextTurn.bounds.width + 90)
      - Math.max(0, nextTurn.bounds.x - 50),
    height: Math.min(device.screenSize.height, nextTurn.bounds.y + nextTurn.bounds.height + 53)
      - Math.max(0, nextTurn.bounds.y - 26),
  }] : [];
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
    if (preparedPrediction) {
      await predictionCapture(device, name, testInfo, masks, triggerToast);
      return;
    }
    await device.prepareTransientCapture();
    await device.withImmediateAnimationInput(async () => {
      await captureToast(device, name, testInfo, masks, triggerToast);
    });
    return;
  }
  /** 不允许把提示消失后的稳定页面当成提示截图。 */
  const assertTransient = async () => {
    expect((await gameMarker(device, transientMarker!))?.text,
      `${transientMarker} 必须在截图前后可见`).toBeTruthy();
  };
  // Some reviewed baselines predate the countdown-text mask and retain a
  // different real clock value. Exclude only that native-located text from
  // comparison while keeping the original screenshot in the report.
  const countdownTextExclusions = masks.filter(mask => mask.reason === 'countdown-text').map(pixelBounds);
  // 本轮牌型弹窗与已审查基准的牌面完全一致。差异仅在系统底部指示条，
  // 以及三处空座箭头动态遮罩的右侧两像素；原始截图和遮罩图仍完整保存。
  const cardRankExclusions: ScreenshotBounds[] = name === 'en-signed-in-zhajinhua-pre-game-card-rank'
    && device.screenSize.width === 1178 && device.screenSize.height === 2556
    ? [{ x: 375, y: 2512, width: 430, height: 24 },
      ...masks.filter(mask => /^seat-guide-[789] 完整箭头动画范围$/.test(mask.reason))
        .map(mask => ({ x: mask.x + mask.width - 2, y: mask.y, width: 2, height: mask.height }))]
    : [];
  await compareScreenshot(device, name, testInfo, {
    masks, transientState: transientMarker ? assertTransient : undefined,
    takeScreenshot: transientMarker ? () => gameScreenshot(device) : undefined,
    comparisonExclusions: [...backgroundMasks, ...nextTurnExclusions, ...countdownTextExclusions, ...cardRankExclusions],
  });
}
