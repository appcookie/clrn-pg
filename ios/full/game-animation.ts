import { assertVisual } from './device';
import { readFileSync } from 'node:fs';
import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import { gameNodes } from './game-controls';
import { maskScreenshot, type ScreenshotMask } from './screenshot';
import { motionParts, samePixels } from './motion-regions';

/**
 * 比牌的四个高亮框各自循环闪烁，按各自相位比较，不遮掉其中的玩家内容。
 * 页面其余像素保持普通基准比较；每个动画分区都必须在真实采样帧中匹配基准。
 * @param device - 专用模拟器连接。
 * @param name - 共用状态生成的基准名称。
 * @param testInfo - 当前测试报告。
 * @param masks - 房号、倒计时等既有小区域遮罩。
 */
export async function captureChallengeAnimation(device: AndroidDevice, name: string, testInfo: TestInfo,
  masks: ScreenshotMask[]): Promise<void> {
  const selectors = (await gameNodes(device)).filter(node => node.res === 'challenge_player_selector');
  expect(selectors).toHaveLength(4);
  // iOS 的高亮范围直接取 XCUITest 实际边界，不沿用 Android 被头像裁切后的补偿。
  const regions = selectors.map(({ bounds }) => bounds);
  await testInfo.attach(`${name}-animation-regions`, { body: JSON.stringify(regions), contentType: 'application/json' });
  await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  const reference = process.env.IOS_VISUAL_MODE !== 'compare';
  const expected = reference ? undefined : motionParts(readFileSync(testInfo.snapshotPath(`${name}.png`)), regions);
  const matched = regions.map(() => false);
  const moving = regions.map(() => false);
  const matchingFrames: Buffer[] = [];
  let previous: ReturnType<typeof motionParts> | undefined;
  let stableSince = Date.now();
  const started = Date.now();
  let best: { bytes: Buffer; original: Buffer; score: number } | undefined;
  let latest: Buffer | undefined;
  try {
    await expect(async () => {
      const original = await device.screenshot();
      latest = maskScreenshot(original, masks);
      const parts = motionParts(latest, regions);
      if (!previous || !parts.outside.equals(previous.outside)) {
        stableSince = Date.now();
        best = undefined;
      }
      parts.regions.forEach((part, index) => {
        if (previous && !part.equals(previous.regions[index])) moving[index] = true;
      });
      previous = parts;
      if (!best || parts.score > best.score) best = { bytes: latest, original, score: parts.score };
      if (expected) {
        expect(samePixels(parts.outside, expected.outside), '动画之外的全部像素必须匹配基准').toBe(true);
        parts.regions.forEach((part, index) => {
          if (!matched[index] && samePixels(part, expected.regions[index])) {
            matched[index] = true;
            matchingFrames[index] = original;
          }
        });
        expect(matched, '四位玩家及高亮框必须各自在真实帧中完整匹配基准').toEqual([true, true, true, true]);
      }
      expect(moving, '四个选择框应实际闪烁').toEqual([true, true, true, true]);
      expect(Date.now() - started).toBeGreaterThanOrEqual(4000);
      expect(Date.now() - stableSince, '动画之外的像素须连续稳定两秒').toBeGreaterThanOrEqual(2000);
    }).toPass({ timeout: 30_000, intervals: [100] });
    expect((await gameNodes(device)).filter(node => node.res === 'challenge_player_selector').map(node => node.bounds))
      .toEqual(selectors.map(node => node.bounds));
    await testInfo.attach(`${name}-original`, { body: best!.original, contentType: 'image/png' });
    await testInfo.attach(name, { body: best!.bytes, contentType: 'image/png' });
    if (reference) await assertVisual(best!.bytes, `${name}.png`, testInfo);
    for (const [index, frame] of matchingFrames.entries()) {
      await testInfo.attach(`${name}-matched-player-${index + 1}`, { body: frame, contentType: 'image/png' });
    }
  } catch (error) {
    if (latest) await testInfo.attach(`${name}-animation-failure`, { body: latest, contentType: 'image/png' });
    throw error;
  }
}
