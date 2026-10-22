import { expect, type TestInfo } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { comparePixels } from '../visual.mjs';
import type { NativeDevice } from './native-device';
import { gameConnectionState, gameNodes, gameScreenshot, gameTapCurrent, type NativeNode } from './game-controls';
import { countdownMask, foregroundPanels, networkStatusMask, screenshotMaskNodes,
  seatGuideMotionBounds, subtractPanel, visibleMasks } from './game-masks';
import { playerCountdownNodes } from './game-countdown';
import { maskScreenshot, type ScreenshotBounds, type ScreenshotMask } from './screenshot';

const expectedCards = ['2s', '7c', 'ah', 'kd', 'qs'];
const targets = ['view-community-cards-container', 'view-community-cards-countdown',
  'view-community-close-button', 'community_card_name_text'];

type Observation = Awaited<ReturnType<NativeDevice['inputObservation']>>;

function within(bounds: ScreenshotBounds, container: ScreenshotBounds): boolean {
  return bounds.x >= container.x && bounds.y >= container.y
    && bounds.x + bounds.width <= container.x + container.width
    && bounds.y + bounds.height <= container.y + container.height;
}

/** Native card-name labels sit 50 logical points below each modal card. */
function modalCardLabel(bounds: ScreenshotBounds, container: ScreenshotBounds): boolean {
  return bounds.x >= container.x && bounds.x + bounds.width <= container.x + container.width
    && bounds.y >= container.y && bounds.y + bounds.height <= container.y + container.height * 1.5;
}

/** Read the five cards and live countdown from one focused XCTest query. */
export function remainingCardsState(nodes: Observation): { container: ScreenshotBounds; countdown: NativeNode } | undefined {
  if (gameConnectionState(nodes).connecting) return;
  const containers = nodes.filter(node => node.res === 'view-community-cards-container');
  if (!containers.length) return;
  expect(containers, '剩余公共牌弹窗必须唯一').toHaveLength(1);
  const container = containers[0].bounds;
  const countdown = nodes.find(node => node.res === 'view-community-cards-countdown' && within(node.bounds, container));
  const close = nodes.find(node => node.res === 'view-community-close-button' && within(node.bounds, container));
  const names = nodes.filter(node => node.res === 'community_card_name_text' && modalCardLabel(node.bounds, container))
    .map(node => node.text || '').sort();
  // Cards briefly expose their backs while the real reveal animation runs.
  if (!countdown || !close || names.length !== 5 || names.some((name, index) => name !== expectedCards[index])) return;
  expect(countdown.text, '弹窗倒计时必须有效').toMatch(/^\d{1,2}$/);
  return { container, countdown };
}

/** Prepare only the changing table pixels while the ten-second modal is still closed. */
export function remainingCardsBackgroundMasks(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotMask[] {
  const panels = foregroundPanels(nodes, screen);
  const masks: ScreenshotMask[] = [];
  for (const node of new Set([...screenshotMaskNodes(nodes), ...playerCountdownNodes(nodes, 'texas-holdem')])) {
    const add = (mask: ScreenshotMask) => masks.push(...visibleMasks(mask, node, panels));
    if (node.res === 'ping-screen-container') add(networkStatusMask(node.bounds));
    else if (node.res === 'game-network-proxy-code' || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(node.text || ''))
      add({ ...node.bounds, reason: node.res || '保座或加时冷却倒计时' });
    else if (node.res === 'texas-holdem-active-countdown')
      add({ x: node.bounds.x - 2, y: node.bounds.y - 2, width: node.bounds.width + 4,
        height: node.bounds.height + 4, reason: 'texas-holdem-active-countdown 含两像素绘制边缘' });
    else if (/^seat-guide-\d+$/.test(node.res || ''))
      add({ ...seatGuideMotionBounds(node.bounds), reason: `${node.res} 完整箭头动画范围` });
  }
  return masks;
}

/** Finish all modal assertions and the stable endpoint capture before its ten-second auto-close. */
export async function captureRemainingCards(device: NativeDevice, testInfo: TestInfo | undefined,
  capture: (state: string, masks: ScreenshotMask[], triggerToast: undefined, heldScreenshot: Buffer) => Promise<void>): Promise<void> {
  const backgroundMasks = remainingCardsBackgroundMasks(await gameNodes(device), device.screenSize);
  await device.prepareTransientCapture();
  await device.withImmediateAnimationInput(async () => {
    await gameTapCurrent(device, 'texas-holdem-show-remain-community-card-button');
    const readyDeadline = Date.now() + 30_000;
    const observations: Observation[] = [];
    const observe = async () => {
      const nodes = await device.inputObservation(targets);
      observations.push(nodes);
      return remainingCardsState(nodes);
    };
    try {
      let state: Awaited<ReturnType<typeof observe>>;
      do {
        state = await observe();
        if (state) break;
        await delay(100);
      } while (Date.now() < readyDeadline);
      expect(state, '十秒倒计时内必须显示五张剩余公共牌').toBeDefined();
      const deadline = Date.now() + Math.max(0, Number(state!.countdown.text) * 1_000 - 750);
      const masks = [...backgroundMasks.flatMap(mask => subtractPanel(mask, state!.container)),
        countdownMask(state!.countdown.bounds, state!.countdown.text || '')];
      let previous = maskScreenshot(await gameScreenshot(device), masks);
      let stableSince = Date.now();
      let original: Buffer | undefined;
      for (;;) {
        expect(Date.now(), '剩余公共牌弹窗自动关闭前截图必须稳定').toBeLessThan(deadline);
        await delay(250);
        expect(await observe(), '截图后五张公共牌及倒计时必须仍可见').toBeDefined();
        original = await gameScreenshot(device);
        const current = maskScreenshot(original, masks);
        if (comparePixels(previous, current).matches && Date.now() - stableSince >= 250) break;
        previous = current;
        stableSince = Date.now();
      }
      await capture('remaining_cards', masks, undefined, original!);
    } finally {
      await testInfo?.attach('texas-remaining-cards-focused-observations', {
        body: JSON.stringify(observations), contentType: 'application/json',
      });
    }
  });
}
