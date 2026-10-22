import type { TestInfo } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import type { NativeDevice } from './native-device';
import { gameNodes, gameScreenshot, gameTapCurrent, type NativeNode } from './game-controls';
import { foregroundPanels, networkStatusMask, screenshotMaskNodes,
  seatGuideMotionBounds, subtractPanel, visibleMasks } from './game-masks';
import { playerCountdownNodes } from './game-countdown';
import { type ScreenshotMask } from './screenshot';

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

/** The modal covers a large, otherwise still part of the table. Simulator screenshots
 * can observe it while an XCTest tap or accessibility query is still in flight. */
export function remainingCardsOverlayRatio(before: PNG, after: PNG): number {
  if (before.width !== after.width || before.height !== after.height) throw new Error('剩余公共牌截图尺寸不一致');
  const left = Math.floor(before.width * .18), right = Math.ceil(before.width * .82);
  const top = Math.floor(before.height * .17), bottom = Math.ceil(before.height * .36);
  let changed = 0, samples = 0;
  for (let y = top; y < bottom; y += 3) for (let x = left; x < right; x += 3) {
    const offset = (y * before.width + x) * 4;
    if ([0, 1, 2].some(channel => Math.abs(before.data[offset + channel] - after.data[offset + channel]) > 24)) changed++;
    samples++;
  }
  return changed / samples;
}

async function watchRemainingCards(device: NativeDevice, before: Buffer) {
  const baseline = PNG.sync.read(before);
  const started = Date.now();
  const observations: { elapsedMs: number; changedRatio: number }[] = [];
  let firstSeen = 0;
  let best: { image: Buffer; changedRatio: number } | undefined;
  while (Date.now() - started < 70_000) {
    const image = await gameScreenshot(device);
    const changedRatio = remainingCardsOverlayRatio(baseline, PNG.sync.read(image));
    observations.push({ elapsedMs: Date.now() - started, changedRatio });
    if (!best || changedRatio > best.changedRatio) best = { image, changedRatio };
    if (changedRatio > .12) {
      firstSeen ||= Date.now();
      if (Date.now() - firstSeen >= 1_500) return { image, observations };
    } else firstSeen = 0;
    await delay(250);
  }
  return { image: undefined, observations, best };
}

/** Preserve the live modal frame before its ten-second auto-close. The reviewed
 * full-screen baseline checks the five card faces and all surrounding pixels. */
export async function captureRemainingCards(device: NativeDevice, testInfo: TestInfo | undefined,
  capture: (state: string, masks: ScreenshotMask[], triggerToast: undefined, heldScreenshot: Buffer) => Promise<void>): Promise<void> {
  const backgroundMasks = remainingCardsBackgroundMasks(await gameNodes(device), device.screenSize);
  const before = await gameScreenshot(device);
  await device.prepareTransientCapture();
  await device.withImmediateAnimationInput(async () => {
    let watcher: Promise<Awaited<ReturnType<typeof watchRemainingCards>> | Error> | undefined;
    await gameTapCurrent(device, 'texas-holdem-show-remain-community-card-button', undefined,
      () => { watcher = watchRemainingCards(device, before).catch(error => error as Error); });
    if (!watcher) throw new Error('剩余公共牌点击没有启动原生截图');
    const result = await watcher;
    if (result instanceof Error) throw result;
    await testInfo?.attach('texas-remaining-cards-simulator-observations', {
      body: JSON.stringify(result.observations), contentType: 'application/json',
    });
    if (!result.image) {
      if (result.best) await testInfo?.attach('texas-remaining-cards-best-observed-screen', {
        body: result.best.image, contentType: 'image/png',
      });
      throw new Error('原生截图在 70 秒内没有看到剩余公共牌弹窗');
    }
    const panel = { x: Math.floor(device.screenSize.width * .18), y: Math.floor(device.screenSize.height * .17),
      width: Math.ceil(device.screenSize.width * .64), height: Math.ceil(device.screenSize.height * .19) };
    const masks = backgroundMasks.flatMap(mask => subtractPanel(mask, panel));
    await capture('remaining_cards', masks, undefined, result.image);
  });
}
