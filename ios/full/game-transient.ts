// 短提示先开始原生录像，再单次触发；停止后从原片关键帧验证文字和像素。
import { assertVisual } from './device';
import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import { subtractPanel } from './game-masks';
import { maskScreenshot, type ScreenshotMask } from './screenshot';
import { recordNativeVideoFrames } from './video-frames';
import { comparePixels } from '../visual.mjs';
import { toastKeyframes } from './toast-keyframes';
import { recordedToastPanel } from './toast-panel';
import { recognizeRecordedText, assertRecordedToastText } from './recorded-text';
import { animationRecordOnly } from './record-only';

const statisticsHelp: Record<string, string> = {
  en: 'It means actively investing money in the pot',
  'zh-Hans': '表示主动投钱到底池',
  'zh-Hant': '表示主動投錢到底池',
};

/** 保留完整录像，即使后续语义、关键帧或基准验证失败也能回看本次动作。 */
export async function captureToast(device: NativeDevice, name: string, testInfo: TestInfo,
  backgroundMasks: ScreenshotMask[], trigger: () => Promise<string | void>,
  record = recordNativeVideoFrames, recognize = recognizeRecordedText,
  locate = recordedToastPanel): Promise<void> {
  if (animationRecordOnly) {
    await record(device, name, { x: 0, y: 0, ...device.screenSize }, trigger, testInfo, 3500, 1);
    return;
  }
  let expectedText: string | void;
  const frames = await record(device, name, { x: 0, y: 0, ...device.screenSize }, async () => {
    expectedText = await trigger();
  }, testInfo, 3500, 10, undefined, 'xctest');
  if (!expectedText! && name.endsWith('-statistics-help')) {
    expectedText = statisticsHelp[Object.keys(statisticsHelp).find(locale => name.startsWith(`${locale}-`)) ?? ''];
  }
  expect(expectedText!, '短提示必须有明确的可见文案预期').toBeTruthy();
  const { bounds: panel, frameIndices, panels } = await locate(frames);
  const masks = backgroundMasks.flatMap(mask => subtractPanel(mask, panel));
  const indices = await toastKeyframes(frames, panel, masks, frameIndices);
  const observations = await recognize(indices.map(index => frames[index]));
  const padding = Math.ceil(device.screenSize.width / 100);
  const textPanels = indices.map(index => {
    const bounds = panels[frameIndices.indexOf(index)];
    // 保护区含动画路径与阴影；文字必须位于本张实际白色横幅内部，
    // 不能把路径中的状态栏或横幅下方网络延迟的同名数字当成提示。
    return { x: bounds.x + padding, y: bounds.y + padding,
      width: bounds.width - padding * 2, height: bounds.height - padding * 2 };
  });
  await testInfo.attach(`${name}-toast-observation`, {
    body: JSON.stringify({ source: 'recorded-keyframe-ocr', expectedText: expectedText!, panel, textPanels, observations }),
    contentType: 'application/json',
  });
  expect(observations).toHaveLength(3);
  observations.forEach((lines, index) => assertRecordedToastText(lines, expectedText!, textPanels[index], device.screenSize));
  const keyframes = [];
  for (const [order, index] of indices.entries()) {
    const attachment = `${name}-verified-keyframe-${order + 1}`;
    await testInfo.attach(attachment, { body: frames[index], contentType: 'image/png' });
    keyframes.push({ attachment, timestampMs: frames.timestampsMs![index], frameIndex: frames.sourceFrameIndices?.[index] ?? index });
  }
  await testInfo.attach(`${name}-video-keyframes`, { body: JSON.stringify(keyframes), contentType: 'application/json' });
  await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  const representative = maskScreenshot(frames[indices[1]], masks);
  for (const index of indices) expect(comparePixels(maskScreenshot(frames[index], masks), representative).matches).toBe(true);
  await assertVisual(representative, `${name}.png`, testInfo);
}
