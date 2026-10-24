import { assertVisual } from './device';
import { recordScreenSamples } from './video-frames';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import { frameColorDistance, framePaletteDistance } from './animation-transition';
import { gameScreenshot } from './game-controls';
import { cropNativeFrame, samePixels } from './motion-regions';
import type { ScreenshotBounds } from './screenshot';
import { baselinePath } from './baseline-path.mjs';
import { shortAnimationMinimumFrames } from './video-timeline';
import { assetKeyframes } from './asset-keyframes';
import { animationRecordOnly } from './record-only';

type NativeFrame = { capturedAt: number; png: string };

/**
 * 真实房间消息触发的短 WebP 效果：记录静态背景和两张不同的播放关键帧。
 * @param device - 已连接的原生模拟器。
 * @param name - 素材和动效名称。
 * @param info - 测试报告和快照位置。
 * @param region - 效果在屏幕上的绘制区域。
 * @param trigger - 实际发送房间消息的操作。
 * @param flightRegion - 道具从发送者飞向目标时经过的区域。
 */
export async function captureAssetSequence(device: AndroidDevice, name: string, info: TestInfo,
  region: ScreenshotBounds, trigger: () => Promise<unknown>, flightRegion?: ScreenshotBounds): Promise<void> {
  if (animationRecordOnly) {
    await recordScreenSamples(device, name, info, trigger, 5000);
    return;
  }
  /**
   * 从完整原生截图中裁出效果范围。
   * @param bytes - 原生截图 PNG。
   */
  const crop = (bytes: Buffer) => cropNativeFrame(bytes, region);
  const beforeScreen = await gameScreenshot(device);
  const before = await crop(beforeScreen);
  // XCTest 在静止区间输出稀疏帧；真实 puchi 录像在 2.5 秒窗口仅得到 19 帧。
  // 短表情保留 5 秒观察窗口、至少 10 个原始采样及独立出现、变化、恢复断言。
  const screens = (await recordScreenSamples(device, name, info, trigger, 5000, undefined, shortAnimationMinimumFrames)).map(frame => Buffer.from(frame.png, 'base64'));
  const timeline: Buffer[] = [];
  for (const screen of screens) timeline.push(await crop(screen));
  expect(timeline.length).toBeGreaterThanOrEqual(10);
  expect(frameColorDistance(before, timeline[0]), `${name} 必须在采样开始后播放`).toBeLessThan(10);
  const { visible, peak, changed, distances } = assetKeyframes(timeline);
  await info.attach(`${name}-timeline`, { body: JSON.stringify({ peak: peak.index, changed: changed.index,
    background: 0, minimumForegroundFraction: 0.5, distances }), contentType: 'application/json' });
  for (const [phase, frame] of [['start', before], ['peak', peak.frame], ['changed', changed.frame]] as const) {
    const file = `${name}-${phase}.png`;
    await info.attach(file, { body: frame, contentType: 'image/png' });
    if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(frame, file, info);
    else {
      const references = [readFileSync(baselinePath(file))];
      const alternate = baselinePath(`${name}-${phase}-alternate.png`);
      if (phase !== 'start' && existsSync(alternate)) references.push(readFileSync(alternate));
      // 飞行道具在接收者身上经过的时刻可变；颜色构成锁定素材，下面的飞行区域另锁定位置。
      const compare = flightRegion && phase !== 'start' ? framePaletteDistance : frameColorDistance;
      expect(Math.min(...(phase === 'start' ? [before] : visible.map(item => item.frame))
        .flatMap(candidate => references.map(reference => compare(candidate, reference)))),
      `${name} ${phase} 视觉回归`)
        .toBeLessThanOrEqual(15);
    }
  }
  await setTimeout(2500);
  expect(samePixels(before, await crop(await gameScreenshot(device))), `${name} 须播放结束并恢复画面`).toBe(true);
  if (flightRegion) {
    /**
     * 裁切道具经过的中途路线，独立锁定飞行轨迹。
     * @param bytes - 原生完整屏幕 PNG。
     */
    const flight = (bytes: Buffer) => cropNativeFrame(bytes, flightRegion);
    const flightStart = await flight(beforeScreen);
    const flightFrames: Buffer[] = [];
    for (const screen of screens) flightFrames.push(await flight(screen));
    const moving = flightFrames.map((frame, index) => ({ frame, index,
      distance: frameColorDistance(flightStart, frame) })).filter(item => item.distance > 1);
    expect(moving.length, `${name} 道具必须飞过目标路线`).toBeGreaterThanOrEqual(2);
    const farthest = moving.reduce((best, item) => item.distance > best.distance ? item : best);
    const alternate = moving.reduce((best, item) => frameColorDistance(farthest.frame, item.frame)
      > frameColorDistance(farthest.frame, best.frame) ? item : best);
    expect(frameColorDistance(farthest.frame, alternate.frame), `${name} 飞行位置必须变化`).toBeGreaterThan(1);
    for (const [phase, frame] of [['start', flightStart], ['peak', farthest.frame],
      ['changed', alternate.frame]] as const) {
      const file = `${name}-flight-${phase}.png`;
      await info.attach(file, { body: frame, contentType: 'image/png' });
      if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(frame, file, info);
      else {
        const references = [readFileSync(baselinePath(file))];
        const alternate = baselinePath(`${name}-flight-${phase}-alternate.png`);
        if (phase !== 'start' && existsSync(alternate)) references.push(readFileSync(alternate));
        const secondAlternate = baselinePath(`${name}-flight-${phase}-alternate-2.png`);
        if (phase !== 'start' && existsSync(secondAlternate)) references.push(readFileSync(secondAlternate));
        expect(Math.min(...(phase === 'start' ? [flightStart] : moving.map(item => item.frame))
          .flatMap(candidate => references.map(reference => frameColorDistance(candidate, reference)))),
        `${name} 飞行 ${phase} 视觉回归`)
          .toBeLessThanOrEqual(15);
      }
    }
  }
}
