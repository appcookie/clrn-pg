import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { gameScreenshot } from './game-controls';
import { motionParts, samePixels } from './motion-regions';

/**
 * 只把目标区域的真实像素变化算作动画；每个独立区域都须出现可见变化。
 * @param first - 第一帧各区域像素。
 * @param current - 当前帧各区域像素。
 */
export function changedMotionRegions(first: Buffer[], current: Buffer[]): boolean[] {
  if (first.length !== current.length) throw new Error('动画区域数量在采样期间变化。');
  return first.map((part, index) => !samePixels(part, current[index]));
}

/**
 * 从实际模拟器连续采样循环动画，静态整页仍交由既有截图基准比较。
 * @param device - 使用固定原生驱动的专用模拟器。
 * @param name - 已有静态基准的状态名。
 * @param testInfo - 当前测试报告。
 * @param regions - 每个独立动画的完整绘制区域。
 * @param masks - 普通截图使用的小区域动态遮罩；采样保留未遮罩原图。
 * @param options - 可选的截图方法与最长采样时间。
 */
export async function verifyLoopAnimation(device: AndroidDevice, name: string, testInfo: TestInfo,
  regions: ScreenshotBounds[], masks: ScreenshotMask[],
  options: { takeScreenshot?: () => Promise<Buffer>; timeoutMs?: number } = {}): Promise<void> {
  expect(regions.length, '须找到至少一个可见的原生动画区域').toBeGreaterThan(0);
  // 与已有遮罩采用同一坐标；保留整张原图，以便审查目标和周边像素。
  await testInfo.attach(`${name}-motion-regions`, {
    body: JSON.stringify(regions), contentType: 'application/json',
  });
  await testInfo.attach(`${name}-motion-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  const takeScreenshot = options.takeScreenshot || (() => gameScreenshot(device));
  const firstFrame = await takeScreenshot();
  const first = motionParts(firstFrame, regions).regions;
  const moved = regions.map(() => false);
  let changedFrame: Buffer | undefined;
  let lastFrame = firstFrame;
  const deadline = Date.now() + (options.timeoutMs || 4000);
  const intervals = [137, 263, 181, 347, 223, 389];
  let sample = 0;
  try {
    while (Date.now() < deadline && moved.some(value => !value)) {
      // 交错间隔避免截图耗时刚好与 1 秒箭头周期同相，导致动画误判为静止。
      await setTimeout(intervals[sample++ % intervals.length]);
      lastFrame = await takeScreenshot();
      const changed = changedMotionRegions(first, motionParts(lastFrame, regions).regions);
      if (changed.some(Boolean) && !changedFrame) changedFrame = lastFrame;
      changed.forEach((value, index) => { if (value) moved[index] = true; });
    }
    expect(moved, '每个动画区域都应相对首帧发生可见像素变化')
      .toEqual(regions.map(() => true));
  } finally {
    await testInfo.attach(`${name}-motion-first`, { body: firstFrame, contentType: 'image/png' });
    if (changedFrame) await testInfo.attach(`${name}-motion-changed`, { body: changedFrame, contentType: 'image/png' });
    await testInfo.attach(`${name}-motion-last`, { body: lastFrame, contentType: 'image/png' });
  }
}
