// 短提示先开始原生录像，再单次触发并取得语义；图像验收使用原片关键帧。
import { assertVisual } from './device';
import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import { gameConnectionState } from './game-controls';
import { subtractPanel } from './game-masks';
import { maskScreenshot, type ScreenshotMask } from './screenshot';
import { recordNativeVideoFrames } from './video-frames';
import { samePixels } from './motion-regions';
import { toastKeyframes } from './toast-keyframes';

/** 保留完整录像，即使后续语义、关键帧或基准验证失败也能回看本次动作。 */
export async function captureToast(device: NativeDevice, name: string, testInfo: TestInfo,
  backgroundMasks: ScreenshotMask[], trigger: () => Promise<string | void>,
  record = recordNativeVideoFrames): Promise<void> {
  let expectedText: string | void;
  let observation: Awaited<ReturnType<NativeDevice['inputObservation']>> = [];
  const frames = await record(device, name, { x: 0, y: 0, ...device.screenSize }, async () => {
    expectedText = await trigger();
    observation = await device.inputObservation(['toastText1', 'toast-container']);
  }, testInfo, 3500, 10, undefined, 'xctest');
  await testInfo.attach(`${name}-toast-observation`, { body: JSON.stringify(observation), contentType: 'application/json' });
  expect(gameConnectionState(observation).connecting, '提示期间不能出现连接等待').toBe(false);
  const text = observation.find(node => node.res === 'toastText1');
  const panel = observation.find(node => node.res === 'toast-container');
  expect(text?.text, '录像期间必须实际观察到提示文字').toBeTruthy();
  if (expectedText!) expect(text!.text).toContain(expectedText!);
  expect(panel, '提示面板必须具有真实原生边界').toBeDefined();
  const masks = backgroundMasks.flatMap(mask => subtractPanel(mask, panel!.bounds));
  const indices = await toastKeyframes(frames, text!.bounds, masks);
  const keyframes = [];
  for (const [order, index] of indices.entries()) {
    const attachment = `${name}-verified-keyframe-${order + 1}`;
    await testInfo.attach(attachment, { body: frames[index], contentType: 'image/png' });
    keyframes.push({ attachment, timestampMs: frames.timestampsMs![index] });
  }
  await testInfo.attach(`${name}-video-keyframes`, { body: JSON.stringify(keyframes), contentType: 'application/json' });
  await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  const representative = maskScreenshot(frames[indices[1]], masks);
  for (const index of indices) expect(samePixels(maskScreenshot(frames[index], masks), representative)).toBe(true);
  await assertVisual(representative, `${name}.png`, testInfo);
}
