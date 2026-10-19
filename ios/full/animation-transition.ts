import { animationRegion } from './animation-region';
import { assertVisual } from './device';
import { screenBounds } from './screen-geometry';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { NativeDevice as AndroidDevice } from './native-device';
import { gameScreenshot } from './game-controls';
import { motionParts, samePixels } from './motion-regions';
import { maskScreenshot, type ScreenshotBounds, type ScreenshotMask } from './screenshot';
import { recordNativeVideoFrames, recordScreenSamples } from './video-frames';
import { alignedVideoDistance, localMotionDistance, mirroredThumbnail, videoThumbnail } from './video-motion';

type NativeFrame = { capturedAt: number; png: string };

/**
 * 局部画面平均色差；忽略编码差异，保留移动、缩放及透明度变化。
 * @param left - 第一张局部 PNG。
 * @param right - 第二张局部 PNG。
 */
export function frameColorDistance(left: Buffer, right: Buffer): number {
  const a = PNG.sync.read(left), b = PNG.sync.read(right);
  if (a.width !== b.width || a.height !== b.height) throw new Error('动画帧尺寸变化');
  let difference = 0;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) difference += Math.abs(a.data[offset + channel] - b.data[offset + channel]);
  }
  return difference / (a.width * a.height * 3);
}

/** 平移弹层的颜色分布距离；保留配色与覆盖比例，允许同一幅画面处在不同纵向位置。
 * @param left - 第一张局部 PNG。
 * @param right - 第二张局部 PNG。
 */
export function framePaletteDistance(left: Buffer, right: Buffer): number {
  const a = PNG.sync.read(left), b = PNG.sync.read(right);
  if (a.width !== b.width || a.height !== b.height) throw new Error('动画帧尺寸变化');
  let difference = 0;
  for (let channel = 0; channel < 3; channel++) {
    const counts = new Int32Array(256);
    for (let offset = channel; offset < a.data.length; offset += 4) {
      counts[a.data[offset]]++;
      counts[b.data[offset]]--;
    }
    let balance = 0;
    for (const count of counts) { balance += count; difference += Math.abs(balance); }
  }
  return difference / (a.width * a.height * 3);
}

/** Select only real in-between frames; video compression alone cannot create a transition.
 * @param before - Exact start frame.
 * @param after - Exact end frame.
 * @param timeline - Frames collected by the native driver.
 * @param samplingMethod - Native capture method.
 */
export function middleCandidates(before: Buffer, after: Buffer, timeline: Buffer[],
  samplingMethod: 'motionFrames' | 'launchFrames' | 'videoFrames'): {
    frame: Buffer; index: number; progress: number; remaining: number }[] {
  const total = frameColorDistance(before, after);
  const minimum = samplingMethod === 'videoFrames' ? Math.min(7, total * 0.2) : 1;
  return timeline.map((frame, index) => ({ frame, index,
    progress: frameColorDistance(before, frame) / total,
    remaining: frameColorDistance(after, frame) / total }))
    .filter(item => item.progress > 0.02 && item.remaining > 0.02
      && frameColorDistance(before, item.frame) > minimum
      && frameColorDistance(after, item.frame) > minimum);
}

/** Require a recorded frame to follow an approved spatial phase, away from both endpoints.
 * @param before - Exact start frame.
 * @param after - Exact end frame.
 * @param candidates - Frames with visible motion.
 * @param anchors - Reviewed native video phases.
 */
export function assertReviewedVideoMiddle(before: Buffer, after: Buffer,
  candidates: { frame: Buffer; progress: number; remaining: number }[], anchors: Buffer[]): void {
  expect(candidates.length, '必须采到起点和终点之间的真实动画帧').toBeGreaterThan(0);
  const total = frameColorDistance(before, after);
  const references = anchors.map(anchor => {
    const thumbnail = videoThumbnail(anchor);
    return { start: frameColorDistance(before, anchor) / total,
      end: frameColorDistance(after, anchor) / total,
      thumbnail, inverted: mirroredThumbnail(thumbnail), localMotion: localMotionDistance(before, anchor) };
  });
  const distances = candidates.flatMap(({ frame, progress, remaining }) => {
    const actual = videoThumbnail(frame);
    return references.map(reference => {
      if (progress < reference.start / 4 || remaining < reference.end / 4) return Infinity;
      const distance = alignedVideoDistance(actual, reference.thumbnail);
      if (distance > 46) return Infinity;
      // A vertically shifted phase can be valid; a mirrored or misplaced drawing cannot.
      const inverted = alignedVideoDistance(actual, reference.inverted);
      if (inverted + 6 < distance) return Infinity;
      // A global flash may have the same colours and mean distance as a sliding panel.
      if (localMotionDistance(before, frame) < Math.max(2.5, reference.localMotion * 0.15)) return Infinity;
      return distance;
    });
  });
  expect(Math.min(...distances), '动画中途帧的实际画面须接近已审查轨迹').toBeLessThanOrEqual(46);
}

/**
 * 点击真实入口期间由 Simulator 录屏逐帧采样；基准约束起点、终点和中途真实像素。
 * @param device - 已连接的 iOS 模拟器。
 * @param name - 本次具体动画效果的基准前缀。
 * @param testInfo - Playwright 测试报告。
 * @param region - 排除无关页面变化的完整动画绘制范围。
 * @param trigger - 使用 XCUITest 执行实际点击，simctl 同时录制画面。
 * @param masks - 区域内与目标无关的独立循环效果；保留掩码说明。
 * @param requiredRegions - 同一效果中必须分别运动的可见子区域。
 * @param settleMs - 触发后仍在滚动的长动画，保持录制并等待完成。
 * @param samplingMethod - 启动页、延迟弹窗或短于截屏间隔的转场使用对应采样命令。
 * @param inspectFrames - 对同一组原生帧中的独立子动画追加视觉断言。
 * @param afterReady - 保持录制并等待异步面板语义就绪，然后继续录制稳定尾段。
 * @param videoPhaseAnchors - 独立绘制层可在不同顺序呈现的额外已审查录屏相位。
 * @param endPhaseAnchors - 手势落点离散化造成的已审查终点画面。
 * @param endCompareMasks - 终点独立数值区域；原始终点仍保留在报告中供审查。
 * @param startPhaseAnchors - 系统启动器布局不同但均已审查的起点画面。
 * @param startCompareMasks - 仅用于比较触发前桌面帧的系统动态图标区域；坐标相对截图裁切范围。
 * @param videoRecorder - 可替换的原生录屏采集器，供完整录屏路径回归测试使用。
 */
export async function captureNativeTransition(device: AndroidDevice, name: string, testInfo: TestInfo,
  region: ScreenshotBounds, trigger: () => unknown, masks: ScreenshotMask[] = [],
  requiredRegions: ScreenshotBounds[] = [], settleMs = 0,
  samplingMethod: 'motionFrames' | 'launchFrames' | 'videoFrames' = 'motionFrames',
  inspectFrames?: (frames: Buffer[], testInfo: TestInfo) => Promise<void>,
  afterReady?: () => Promise<void>, videoPhaseAnchors: string[] = [],
  endPhaseAnchors: string[] = [], endCompareMasks: ScreenshotMask[] = [],
  startPhaseAnchors: string[] = [], startCompareMasks: ScreenshotMask[] = [],
  videoRecorder: typeof recordNativeVideoFrames = recordNativeVideoFrames): Promise<void> {
  /**
   * 截出固定的动画绘制区域。
   * @param bytes - 原生完整屏幕 PNG。
   */
  const crop = (bytes: Buffer) => motionParts(maskScreenshot(bytes, masks), [region]).regions[0];
  if (masks.length) await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  if (startCompareMasks.length) await testInfo.attach(`${name}-start-masks`, {
    body: JSON.stringify(startCompareMasks), contentType: 'application/json',
  });
  const beforeScreen = await gameScreenshot(device);
  const beforeNodes = await device.nodes();
  // 旧编排的采样名称仅保留调用兼容；iOS 全部使用视频的空间轨迹校验。
  samplingMethod = 'videoFrames';
  // iOS 的所有轨迹使用 simctl 原分辨率视频，截图通道只用于精确端点。
  const recorded = await videoRecorder(device, name, { x: 0, y: 0, ...device.screenSize }, async () => {
    await trigger();
    if (settleMs) await setTimeout(settleMs);
    if (afterReady) await afterReady();
  }, testInfo);
  const frames = recorded.map((png, index) => ({ capturedAt: recorded.timestampsMs?.[index] ?? index * 1000 / 30,
    png: png.toString('base64') }));
  expect(frames.length, '原生驱动至少采集三帧').toBeGreaterThanOrEqual(3);
  const originals = frames.map(frame => Buffer.from(frame.png, 'base64'));
  if (inspectFrames) await inspectFrames(originals, testInfo);
  const afterScreen = await gameScreenshot(device);
  const afterNodes = await device.nodes();
  const selectedRegion = animationRegion(name, beforeNodes, afterNodes, device, region);
  region = selectedRegion.bounds;
  await testInfo.attach(`${name}-capture-region`, { body: JSON.stringify(selectedRegion), contentType: 'application/json' });
  const before = crop(beforeScreen);
  const timeline = originals.map(crop);
  const after = crop(afterScreen);
  await testInfo.attach(`${name}-timeline`, {
    body: JSON.stringify(frames.map(({ capturedAt }) => capturedAt)), contentType: 'application/json',
  });
  for (const [index, frame] of timeline.entries()) {
    if (samplingMethod === 'videoFrames' && index % 5 !== 0 && index !== timeline.length - 1) continue;
    await testInfo.attach(`${name}-frame-${index}`, { body: frame, contentType: 'image/png' });
  }
  await testInfo.attach(`${name}-start`, { body: before, contentType: 'image/png' });
  await testInfo.attach(`${name}-end`, { body: after, contentType: 'image/png' });
  expect(frameColorDistance(timeline[0], before), '录屏首帧须包含动作前的实际布局').toBeLessThan(10);
  expect(framePaletteDistance(timeline.at(-1)!, after), '录屏结束时动画必须完成').toBeLessThan(10);
  if (requiredRegions.length) {
    const parts = originals.map(frame => motionParts(maskScreenshot(frame, masks), requiredRegions).regions);
    for (const index of requiredRegions.keys()) {
      expect(parts.some(sample => !samePixels(sample[index], parts[0][index])),
        `${name} 第 ${index + 1} 个区域必须独立运动`).toBe(true);
    }
  }
  const total = frameColorDistance(before, after);
  expect(total, '入口点击必须产生足够大的可见变化').toBeGreaterThan(3);
  expect(frameColorDistance(timeline[0], before), '录屏首帧必须更接近起点，不能只有动作后的画面')
    .toBeLessThan(frameColorDistance(timeline[0], after));
  // BottomSheet 的弹簧轨迹可能越过终点；用“同时区别于首尾”选关键帧。
  const candidates = middleCandidates(before, after, timeline, 'videoFrames');
  await testInfo.attach(`${name}-progress`, {
    body: JSON.stringify({ total, frames: timeline.map(frame => frameColorDistance(before, frame) / total) }),
    contentType: 'application/json',
  });
  expect(candidates.length, '必须采到起点和终点之间的真实动画帧').toBeGreaterThan(0);
  const middle = candidates.reduce((best, item) => Math.min(item.progress, item.remaining)
    > Math.min(best.progress, best.remaining) ? item : best);
  await testInfo.attach(`${name}-middle`, { body: middle.frame, contentType: 'image/png' });
  await testInfo.attach(`${name}-middle-progress`, {
    body: JSON.stringify({ index: middle.index, progress: middle.progress, remaining: middle.remaining }),
    contentType: 'application/json',
  });
  if (process.env.IOS_VISUAL_MODE !== 'compare') {
    await assertVisual(before, `${name}-start.png`, testInfo);
    await assertVisual(middle.frame, `${name}-middle.png`, testInfo);
    await assertVisual(after, `${name}-end.png`, testInfo);
  } else {
    expect([`${name}-start.png`, ...startPhaseAnchors.filter(file => existsSync(testInfo.snapshotPath(file)))]
      .some(file => samePixels(maskScreenshot(before, startCompareMasks),
        maskScreenshot(readFileSync(testInfo.snapshotPath(file)), startCompareMasks))), '动画起点视觉回归').toBe(true);
    expect([`${name}-end.png`, ...endPhaseAnchors.filter(file => existsSync(testInfo.snapshotPath(file)))]
      .some(file => samePixels(maskScreenshot(after, endCompareMasks),
        maskScreenshot(readFileSync(testInfo.snapshotPath(file)), endCompareMasks))),
    '动画终点视觉回归').toBe(true);
    const reference = readFileSync(testInfo.snapshotPath(`${name}-middle.png`));
    // 原生截图可能落在已审查中途相位的两侧，但靠近起止帧的无关闪屏不能冒充转场。
    // 非录屏路径要求基准变化幅度；录屏路径在空间匹配时逐个检查已审查相位。
    const anchors = [reference, ...videoPhaseAnchors.filter(file => existsSync(testInfo.snapshotPath(file))).map(file => readFileSync(testInfo.snapshotPath(file)))];
    if (samplingMethod === 'videoFrames') assertReviewedVideoMiddle(before, after, candidates, anchors);
    else {
      const reviewedDistances = candidates.flatMap(item => anchors
        .filter(anchor => frameColorDistance(before, item.frame)
          >= Math.min(frameColorDistance(before, anchor) / 2, total * 0.3)
          && frameColorDistance(after, item.frame)
          >= Math.min(frameColorDistance(after, anchor) / 2, total * 0.3))
        .map(anchor => frameColorDistance(item.frame, anchor)));
      expect(Math.min(...reviewedDistances), '动画中途帧的实际画面须接近已审查轨迹')
        .toBeLessThanOrEqual(36);
    }
  }
}

/**
 * 对显示后又消失的提示保存起点、半透明帧和最清晰帧，校验真实入退场轨迹。
 * @param device - 安装固定原生采样驱动的模拟器。
 * @param name - 短时效果名称。
 * @param testInfo - Playwright 快照与报告。
 * @param region - 提示绘制范围，排除其他动态元素。
 * @param trigger - 从独立代理或 ADB 触发提示。
 * @param settleMs - 提示结束后等待画面恢复的时间。
 */
export async function captureTransientTransition(device: AndroidDevice, name: string, testInfo: TestInfo,
  region: ScreenshotBounds, trigger: () => unknown, settleMs = 2500): Promise<void> {
  /**
   * 从完整原生截图裁切提示区域。
   * @param bytes - 原生完整屏幕 PNG。
   */
  const crop = (bytes: Buffer) => motionParts(bytes, [region]).regions[0];
  const before = crop(await gameScreenshot(device));
  const frames = (await recordScreenSamples(device, name, testInfo, trigger)).map(frame => crop(Buffer.from(frame.png, 'base64')));
  expect(frames.length).toBeGreaterThanOrEqual(10);
  await setTimeout(settleMs);
  const after = crop(await gameScreenshot(device));
  for (const [index, frame] of frames.entries()) {
    await testInfo.attach(`${name}-frame-${index}`, { body: frame, contentType: 'image/png' });
  }
  expect(frameColorDistance(frames[0], before), '短时提示须在采样开始后出现').toBeLessThan(10);
  expect(samePixels(before, after), '短时提示应自动消失并恢复原画面').toBe(true);
  const phases = frames.map(frame => ({ frame, distance: frameColorDistance(before, frame) }));
  const peak = phases.reduce((best, item) => item.distance > best.distance ? item : best);
  expect(peak.distance, '短时提示必须产生明显可见变化').toBeGreaterThan(3);
  const middle = phases.filter(item => item.distance > 1 && item.distance < peak.distance - 1)
    .reduce((best, item) => Math.abs(item.distance - peak.distance / 2)
      < Math.abs(best.distance - peak.distance / 2) ? item : best, phases[0]);
  expect(middle.distance, '短时提示须采到半透明动画帧').toBeGreaterThan(1);
  for (const [phase, frame] of [['start', before], ['middle', middle.frame], ['peak', peak.frame]] as const) {
    const file = `${name}-${phase}.png`;
    await testInfo.attach(file, { body: frame, contentType: 'image/png' });
    if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(frame, file, testInfo);
    else {
      const reference = readFileSync(testInfo.snapshotPath(file));
      expect(Math.min(...(phase === 'start' ? [before] : frames)
        .map(candidate => frameColorDistance(candidate, reference))),
      `${name} ${phase} 视觉关键帧须匹配基准`).toBeLessThanOrEqual(12);
    }
  }
}

/**
 * 带秒数的自动消失提示：保存出现前、两种倒计时画面与消失后，逐帧确认实际计时变化。
 * @param device - 安装原生采样驱动的模拟器。
 * @param name - 提示的视觉基线名称。
 * @param testInfo - Playwright 报告与快照。
 * @param region - 包含提示文字和倒计时、排除网络延迟的屏幕范围。
 * @param trigger - 点击真实按钮以触发提示。
 */
export async function captureTimedPrompt(device: AndroidDevice, name: string, testInfo: TestInfo,
  region: ScreenshotBounds, trigger: () => unknown): Promise<void> {
  /**
   * 裁切固定上方面板。
   * @param bytes - 原生完整屏幕 PNG。
   */
  const crop = (bytes: Buffer) => motionParts(bytes, [region]).regions[0];
  const before = crop(await gameScreenshot(device));
  const frames = await recordNativeVideoFrames(device, name, region, trigger, testInfo);
  expect(frames.length).toBeGreaterThanOrEqual(20);
  expect(framePaletteDistance(before, frames[0]), `${name} 须在采样开始后出现`).toBeLessThan(7);
  const visible = frames.filter(frame => frameColorDistance(before, frame) > 15);
  expect(visible.length, `${name} 须实际显示`).toBeGreaterThanOrEqual(2);
  /**
   * 只截完整提示标题。
   * @param frame - 顶部提示区域的截图。
   */
  const title = (frame: Buffer) => motionParts(frame, [screenBounds(device, { x: 80, y: 45, width: 520, height: 110 })]).regions[0];
  /**
   * 只截底部秒数，避免把提示滑入误认为倒计时。
   * @param frame - 顶部提示区域的截图。
   */
  const timer = (frame: Buffer) => motionParts(frame, [screenBounds(device, { x: 0, y: 165, width: 70, height: 45 })]).regions[0];
  const beforeTitle = title(before);
  const settled = visible.map(frame => ({ frame, heading: title(frame), seconds: timer(frame) }))
    .filter(item => frameColorDistance(beforeTitle, item.heading) > 30);
  expect(settled.length, `${name} 标题须完整出现`).toBeGreaterThanOrEqual(2);
  let pair: { first: Buffer; changed: Buffer } | undefined;
  for (let index = 0; index < settled.length && !pair; index++) {
    const first = settled[index];
    const changed = settled.slice(index + 1).find(item =>
      frameColorDistance(first.heading, item.heading) < 3
      && frameColorDistance(first.seconds, item.seconds) > 4);
    if (changed) pair = { first: first.frame, changed: changed.frame };
  }
  expect(pair, `${name} 标题稳定后倒计时数字必须变化`).toBeDefined();
  await setTimeout(6000);
  const after = crop(await gameScreenshot(device));
  expect(samePixels(after, before), `${name} 倒计时结束后须恢复画面`).toBe(true);
  for (const [phase, frame] of [['start', before], ['visible', pair!.first],
    ['countdown', pair!.changed], ['end', after]] as const) {
    const file = `${name}-${phase}.png`;
    await testInfo.attach(file, { body: frame, contentType: 'image/png' });
    if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(frame, file, testInfo);
    else if (phase === 'start' || phase === 'end') expect(samePixels(frame, readFileSync(testInfo.snapshotPath(file)))).toBe(true);
    else {
      const reference = readFileSync(testInfo.snapshotPath(file));
      expect(Math.min(...visible.map(candidate => frameColorDistance(candidate, reference))),
        `${name} ${phase} 视觉回归`).toBeLessThanOrEqual(12);
    }
  }
}
