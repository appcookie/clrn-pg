import { assertVisual } from './device';
import { baselinePath } from './baseline-path.mjs';
import { recordScreenSamples } from './video-frames';
import { existsSync, readFileSync } from 'node:fs';
import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import { PNG } from 'pngjs';
import { frameColorDistance } from './animation-transition';
import { cropMotionRegion, cropMotionRegions } from './motion-regions';
import type { ScreenshotBounds } from './screenshot';

type NativeFrame = { capturedAt: number; png: string };

/**
 * 单个动态区域的平均亮度，用于从真实动画轨迹选择两端相位。
 * @param bytes - 裁切后的原生 PNG。
 */
function brightness(bytes: Buffer): number {
  const png = PNG.sync.read(bytes);
  let sum = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    sum += (png.data[index] + png.data[index + 1] + png.data[index + 2]) / 3;
  }
  return sum / (png.width * png.height);
}

export { framePaletteDistance } from './animation-transition';

/**
 * 对循环脉动的每个独立控件保存明暗两端真实屏幕关键帧。
 * @param device - 已安装固定原生采样驱动的模拟器。
 * @param name - 具体动画名称。
 * @param testInfo - Playwright 快照与报告。
 * @param regions - 每个独立脉动占位控件的可见范围。
 * @param maxAttempts - 启动相位未知时可跨多个采样窗口寻找完整明暗周期。
 */
export async function captureLoopKeyframes(device: AndroidDevice, name: string, testInfo: TestInfo,
  regions: ScreenshotBounds[], maxAttempts = 1, recordedSamples?: NativeFrame[]): Promise<void> {
  expect(regions.length).toBeGreaterThan(0);
  if (recordedSamples && maxAttempts !== 1) throw new Error('已有真实录像只能分析一次，不能伪装成多个采样窗口');
  await testInfo.attach(`${name}-regions`, { body: JSON.stringify(regions), contentType: 'application/json' });
  const timeline: NativeFrame[] = [];
  const pictures: Buffer[][] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const samples = recordedSamples ?? await recordScreenSamples(device, name, testInfo);
    expect(samples.length).toBeGreaterThanOrEqual(10);
    timeline.push(...samples);
    // Native cells can share a border. Preserve every pixel of both independent
    // controls; these are complete crops, not a partition with an outside image.
    pictures.push(...samples.map(frame => cropMotionRegions(Buffer.from(frame.png, 'base64'), regions, { maxSharedBorder: 3 })));
    if (regions.every((_, index) => {
      const levels = pictures.map(parts => brightness(parts[index]));
      return Math.max(...levels) - Math.min(...levels) > 0.5;
    })) break;
  }
  await testInfo.attach(`${name}-timeline`, {
    body: JSON.stringify(timeline.map(({ capturedAt }) => capturedAt)), contentType: 'application/json',
  });
  for (const index of regions.keys()) {
    const frames = pictures.map(parts => parts[index]);
    const phases = frames.map((frame, position) => ({ frame, position, light: brightness(frame) }));
    const dark = phases.reduce((best, item) => item.light < best.light ? item : best);
    const light = phases.reduce((best, item) => item.light > best.light ? item : best);
    await testInfo.attach(`${name}-${index + 1}-phases`, {
      body: JSON.stringify({ dark: dark.position, light: light.position, delta: light.light - dark.light }),
      contentType: 'application/json',
    });
    await testInfo.attach(`${name}-${index + 1}-dark-frame`, { body: dark.frame, contentType: 'image/png' });
    await testInfo.attach(`${name}-${index + 1}-light-frame`, { body: light.frame, contentType: 'image/png' });
    expect(light.light - dark.light, `${name} 第 ${index + 1} 个占位控件必须脉动`).toBeGreaterThan(0.5);
    for (const [phase, selected] of [['dark', dark], ['light', light]] as const) {
      await testInfo.attach(`${name}-${index + 1}-${phase}`, { body: selected.frame, contentType: 'image/png' });
      const file = `${name}-${index + 1}-${phase}.png`;
      if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(selected.frame, file, testInfo);
      else expect(Math.min(...frames.map(frame => frameColorDistance(frame, readFileSync(baselinePath(file))))),
        `${name} 第 ${index + 1} 个控件的${phase}相位须匹配基准`).toBeLessThanOrEqual(10);
    }
  }
}

/**
 * 对位置变化而亮度几乎不变的循环动画保存两种真实画面，并在回归时逐帧寻找对应相位。
 * @param device - 已安装固定原生采样驱动的模拟器。
 * @param name - 具体动画名称。
 * @param testInfo - Playwright 快照与报告。
 * @param regions - 每个独立运动控件的完整可见范围。
 * @param distanceLimit - 随机图案循环的允许色差，固定外观动画使用默认值。
 * @param compareDistance - 旋转对称效果可比较颜色分布，其余效果逐像素比较。
 * @param maxAttempts - 慢速自动轮播允许连续采样多个窗口，直到观察到真实变化。
 * @param phaseAnchors - 随机循环中经审查的额外真实相位截图。
 */
export async function captureMovingKeyframes(device: AndroidDevice, name: string, testInfo: TestInfo,
  regions: ScreenshotBounds[], distanceLimit = 18,
  compareDistance: (left: Buffer, right: Buffer) => number = frameColorDistance,
  maxAttempts = 1, phaseAnchors: string[] = []): Promise<void> {
  expect(regions.length).toBeGreaterThan(0);
  const pictures: Buffer[][] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const timeline = await recordScreenSamples(device, name, testInfo);
    expect(timeline.length).toBeGreaterThanOrEqual(10);
    pictures.push(...timeline.map(frame => cropMotionRegions(Buffer.from(frame.png, 'base64'), regions)));
    if (regions.every((_, index) => pictures.some(parts => frameColorDistance(parts[index], pictures[0][index]) > 1))) break;
  }
  for (const index of regions.keys()) {
    const frames = pictures.map(parts => parts[index]);
    const first = frames[0];
    const distances = frames.map(frame => frameColorDistance(first, frame));
    const farthestIndex = distances.indexOf(Math.max(...distances));
    expect(distances[farthestIndex], `${name} 第 ${index + 1} 个控件必须运动`).toBeGreaterThan(1);
    for (const [phase, selected] of [['first', first], ['moved', frames[farthestIndex]]] as const) {
      const file = `${name}-${index + 1}-${phase}.png`;
      await testInfo.attach(file, { body: selected, contentType: 'image/png' });
      if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(selected, file, testInfo);
      else {
        const references = [file, ...phaseAnchors.filter(anchor => existsSync(baselinePath(anchor)))].map(anchor => readFileSync(baselinePath(anchor)));
        expect(Math.min(...references.flatMap(reference => frames.map(frame => compareDistance(frame, reference)))),
          `${name} 第 ${index + 1} 个控件的${phase}相位须匹配基准`).toBeLessThanOrEqual(distanceLimit);
      }
    }
  }
}

/**
 * 从同一次事件采集的完整屏幕帧，验证同步出现的第二种动画。
 * @param frames - 主动画采集的原生完整屏幕帧。
 * @param name - 同步动画的基线名称。
 * @param testInfo - Playwright 快照与报告。
 * @param region - 该动画独立的可见范围。
 */
export async function captureConcurrentMotion(frames: Buffer[], name: string, testInfo: TestInfo,
  region: ScreenshotBounds): Promise<void> {
  const pictures = frames.map(frame => cropMotionRegion(frame, region));
  const first = pictures[0];
  const distances = pictures.map(frame => frameColorDistance(first, frame));
  const moved = pictures[distances.indexOf(Math.max(...distances))];
  expect(frameColorDistance(first, moved), `${name} 必须在事件中运动`).toBeGreaterThan(1);
  for (const [phase, selected] of [['first', first], ['moved', moved]] as const) {
    const file = `${name}-${phase}.png`;
    await testInfo.attach(file, { body: selected, contentType: 'image/png' });
    if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(selected, file, testInfo);
    else {
      const reference = readFileSync(baselinePath(file));
      expect(Math.min(...pictures.map(frame => frameColorDistance(frame, reference))),
        `${name} ${phase} 视觉回归`).toBeLessThanOrEqual(18);
    }
  }
}
