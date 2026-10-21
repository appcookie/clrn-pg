import { assertVisual } from './device';
import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import { setTimeout } from 'node:timers/promises';
import type { NativeNode } from './game-controls';
import { subtractPanel } from './game-masks';
import { samePixels } from './motion-regions';
import { maskScreenshot, type ScreenshotMask } from './screenshot';

type Frame = { before: NativeNode; after: NativeNode; panel: NativeNode; capturedAt: number; png: string };

/**
 * 在设备上连续采集短时提示，先检查节点与真实位图，再编码传回；不延长提示或改变动画。
 * @param device - 固定原生驱动连接。
 * @param name - 共用场景的截图名。
 * @param testInfo - 当前测试报告。
 * @param backgroundMasks - 提示出现前准备的背景动态区域。
 * @param expectedText - 操作分支应出现的语义文字。
 */
export async function captureToast(device: AndroidDevice, name: string, testInfo: TestInfo,
  backgroundMasks: ScreenshotMask[], expectedText?: string): Promise<void> {
  const frames: Frame[] = [];
  const rawSamples: Buffer[] = [];
  const observations: { phase: string; at: number }[] = [];
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    observations.push({ phase: 'before-query', at: Date.now() });
    const before = await device.transientMarker('toastText1');
    observations.push({ phase: before?.text ? 'before-visible' : 'before-absent', at: Date.now() });
    if (!before?.text) {
      if (frames.length) break;
      await setTimeout(40);
      continue;
    }
    // 使用已建立的XCTest会话返回无损PNG，避免每帧另起simctl进程。
    // 两张真实截图共享前后语义观测，减少短提示期间的AX往返；原始采集
    // 时刻在截图返回时记录，不能用后续面板查询的耗时冒充像素稳定时间。
    const samples: { png: Buffer; capturedAt: number }[] = [];
    for (let index = 0; index < 2; index++) {
      if (index) await setTimeout(250);
      const png = await device.screenshot();
      const capturedAt = Date.now();
      samples.push({ png, capturedAt });
      observations.push({ phase: 'screenshot', at: capturedAt });
      rawSamples.push(png);
    }
    const after = await device.transientMarker('toastText1');
    observations.push({ phase: after?.text ? 'after-visible' : 'after-absent', at: Date.now() });
    if (!after?.text) break;
    const panel = (await device.transientMarker('toast-container')) || before;
    for (const { png, capturedAt } of samples)
      frames.push({ before, after, panel, capturedAt, png: png.toString('base64') });
  }
  await testInfo.attach(`${name}-frames`, {
    body: JSON.stringify(frames.map(({ png: _png, ...metadata }) => metadata)), contentType: 'application/json',
  });
  await testInfo.attach(`${name}-capture-timing`, {
    body: JSON.stringify(observations), contentType: 'application/json',
  });
  for (const [index, png] of rawSamples.entries())
    await testInfo.attach(`${name}-sample-${index}-original`, { body: png, contentType: 'image/png' });
  expect(frames.length, '提示可见时必须采集至少两帧真实屏幕').toBeGreaterThanOrEqual(2);
  let reference: Buffer | undefined;
  let stableSince = 0;
  let stable: Buffer | undefined;
  for (const [index, frame] of frames.entries()) {
    expect(frame.before.text, '截图前提示必须可见').toBeTruthy();
    expect(frame.after.text, '截图后提示文字必须保持一致').toBe(frame.before.text);
    if (expectedText) expect(frame.before.text).toContain(expectedText);
    expect(frame.panel, '提示面板不能被背景遮罩覆盖').toBeTruthy();
    const masks = backgroundMasks.flatMap(mask => subtractPanel(mask, frame.panel.bounds));
    const original = Buffer.from(frame.png, 'base64');
    const current = maskScreenshot(original, masks);
    await testInfo.attach(`${name}-frame-${index}-original`, { body: original, contentType: 'image/png' });
    await testInfo.attach(`${name}-frame-${index}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
    if (JSON.stringify(frame.before.bounds) !== JSON.stringify(frame.after.bounds)) {
      reference = undefined;
      continue;
    }
    if (!reference || !samePixels(current, reference)) {
      reference = current;
      stableSince = frame.capturedAt;
    } else if (frame.capturedAt - stableSince >= 250) stable = current;
  }
  expect(stable, '提示存在期间全部未遮罩像素必须连续稳定至少 250 毫秒').toBeDefined();
  await testInfo.attach(name, { body: stable!, contentType: 'image/png' });
  await assertVisual(stable!, `${name}.png`, testInfo);
}
