import { animationRegion, endpointMasksInRegion } from './animation-region';
import { assertVisual } from './device';
import { baselinePath } from './baseline-path.mjs';
import { screenBounds } from './screen-geometry';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { NativeDevice as AndroidDevice } from './native-device';
import { gameScreenshot } from './game-controls';
import { cropNativeFrame, cropMotionRegions, motionParts, samePixels } from './motion-regions';
import { decodeFrame, type FramePixels } from './native-frame';
import { maskScreenshot, type ScreenshotBounds, type ScreenshotMask } from './screenshot';
import { attachFrameEvidence } from './frame-evidence';
import { recordNativeVideoFrames, recordScreenSamples } from './video-frames';
import { alignedVideoDistance, localMotionDistance, mirroredThumbnail, videoThumbnail } from './video-motion';
import { seatGuideBackgroundMasks, leaderboardRoomIdentityMask } from './game-masks';
import { shortAnimationMinimumFrames } from './video-timeline';

/**
 * 局部画面平均色差；忽略编码差异，保留移动、缩放及透明度变化。
 * @param left - 第一张局部 PNG。
 * @param right - 第二张局部 PNG。
 */
export function frameColorDistance(left: Buffer, right: Buffer): number {
  return pixelColorDistance(PNG.sync.read(left), PNG.sync.read(right));
}
function pixelColorDistance(a: FramePixels, b: FramePixels): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('动画帧尺寸变化');
  let difference = 0;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    difference += Math.abs(a.data[offset] - b.data[offset])
      + Math.abs(a.data[offset + 1] - b.data[offset + 1])
      + Math.abs(a.data[offset + 2] - b.data[offset + 2]);
  }
  return difference / (a.width * a.height * 3);
}

/** The simulator launcher changes wallpaper tint and asynchronously loads Maps.
 * Keep three reviewed system app icons as fixed spatial anchors;
 * the first recorded video frame must still match this real pre-launch screen.
 */
export function reviewedLauncherStart(actual: Buffer, reference: Buffer): boolean {
  const a = PNG.sync.read(actual), b = PNG.sync.read(reference);
  if (a.width !== b.width || a.height !== b.height) return false;
  // Coordinates are from the reviewed iPhone 16 launcher at 1178 × 2556.
  // Photos, Reminders and Safari interiors avoid the wallpaper, date and Maps load.
  const stable = [[370, 850, 160, 150], [650, 840, 160, 160], [370, 2290, 160, 170]];
  return stable.every(([x, y, width, height]) => {
    const bounds = { x: Math.round(x * a.width / 1178), y: Math.round(y * a.height / 2556),
      width: Math.round(width * a.width / 1178), height: Math.round(height * a.height / 2556) };
    return frameColorDistance(motionParts(actual, [bounds]).regions[0],
      motionParts(reference, [bounds]).regions[0]) <= 2;
  });
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
  return transitionEvidence(before, after, timeline, samplingMethod).candidates;
}

/** Decode each frame once while retaining the original per-pixel arithmetic and thresholds. */
export function transitionEvidence(before: Buffer, after: Buffer, timeline: Buffer[],
  samplingMethod: 'motionFrames' | 'launchFrames' | 'videoFrames') {
  const start = PNG.sync.read(before), end = PNG.sync.read(after);
  const total = pixelColorDistance(start, end);
  const minimum = samplingMethod === 'videoFrames' ? Math.min(7, total * 0.2) : 1;
  const measurements = timeline.map((frame, index) => {
    const picture = PNG.sync.read(frame);
    const fromStart = pixelColorDistance(start, picture), fromEnd = pixelColorDistance(end, picture);
    return { frame, index, progress: fromStart / total, remaining: fromEnd / total, fromStart, fromEnd };
  });
  const candidates = measurements
    .filter(item => item.progress > 0.02 && item.remaining > 0.02
      && item.fromStart > minimum && item.fromEnd > minimum)
    .map(({ frame, index, progress, remaining }) => ({ frame, index, progress, remaining }));
  return { total, progress: measurements.map(item => item.progress), candidates };
}

/** Same arithmetic and candidate rules; decode sequentially to bound raw-frame memory. */
export async function nativeTransitionEvidence(before: Buffer, after: Buffer, timeline: Buffer[]) {
  const start = await decodeFrame(before), end = await decodeFrame(after);
  const total = pixelColorDistance(start, end), minimum = Math.min(7, total * 0.2);
  const progress: number[] = [];
  const candidates: { frame: Buffer; index: number; progress: number; remaining: number }[] = [];
  for (const [index, frame] of timeline.entries()) {
    const picture = await decodeFrame(frame);
    const fromStart = pixelColorDistance(start, picture), fromEnd = pixelColorDistance(end, picture);
    const value = fromStart / total, remaining = fromEnd / total;
    progress.push(value);
    if (value > 0.02 && remaining > 0.02 && fromStart > minimum && fromEnd > minimum) {
      candidates.push({ frame, index, progress: value, remaining });
    }
  }
  return { total, progress, candidates };
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
  const analysis = reviewedVideoMiddleEvidence(before, after, candidates, anchors);
  expect(analysis.matches.some(match => match.rejected.length === 0),
    `动画中途帧的实际画面须接近已审查轨迹；${JSON.stringify(analysis.matches.map(({ candidate, rejected }) =>
      ({ candidate, rejected })))}`).toBe(true);
}

/** Keep the original comparison rules, but report why each real phase failed instead of Infinity. */
export function reviewedVideoMiddleEvidence(before: Buffer, after: Buffer,
  candidates: { frame: Buffer; progress: number; remaining: number }[], anchors: Buffer[]) {
  const total = frameColorDistance(before, after);
  const references = anchors.map(anchor => {
    const thumbnail = videoThumbnail(anchor);
    return { start: frameColorDistance(before, anchor) / total,
      end: frameColorDistance(after, anchor) / total,
      thumbnail, inverted: mirroredThumbnail(thumbnail), localMotion: localMotionDistance(before, anchor) };
  });
  const matches = candidates.flatMap(({ frame, progress, remaining }, candidate) => {
    const actual = videoThumbnail(frame);
    return references.map((reference, anchor) => {
      const rejected: string[] = [];
      if (progress < reference.start / 4) rejected.push('too-close-to-start');
      if (remaining < reference.end / 4) rejected.push('too-close-to-end');
      const distance = alignedVideoDistance(actual, reference.thumbnail);
      if (distance > 46) rejected.push('spatial-difference');
      // A vertically shifted phase can be valid; a mirrored or misplaced drawing cannot.
      const inverted = alignedVideoDistance(actual, reference.inverted);
      if (inverted + 6 < distance) rejected.push('mirrored-or-misplaced');
      // A global flash may have the same colours and mean distance as a sliding panel.
      const motion = localMotionDistance(before, frame), minimumMotion = Math.max(2.5, reference.localMotion * 0.15);
      if (motion < minimumMotion) rejected.push('insufficient-local-motion');
      return { candidate, anchor, progress, remaining,
        minimumProgress: reference.start / 4, minimumRemaining: reference.end / 4,
        distance, maximumDistance: 46, mirroredDistance: inverted, localMotion: motion, minimumMotion, rejected };
    });
  });
  return { matches };
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
 * @param endCompareMasks - 仅比较终点时排除的独立动态区域，使用原生屏幕坐标；原始终点仍保留。
 * @param startPhaseAnchors - 系统启动器布局不同但均已审查的起点画面。
 * @param startCompareMasks - 仅比较起点时排除的独立动态区域，使用原生屏幕坐标。
 * @param videoRecorder - 可替换的原生录屏采集器，供完整录屏路径回归测试使用。
 * @param afterRecording - 录屏停止后、端点比较前校验静态布局，避免慢速原生树查询阻塞短动画。
 */
export async function captureNativeTransition(device: AndroidDevice, name: string, testInfo: TestInfo,
  region: ScreenshotBounds, trigger: () => unknown, masks: ScreenshotMask[] = [],
  requiredRegions: ScreenshotBounds[] = [], settleMs = 0,
  samplingMethod: 'motionFrames' | 'launchFrames' | 'videoFrames' = 'motionFrames',
  inspectFrames?: (frames: Buffer[], testInfo: TestInfo) => Promise<void>,
  afterReady?: () => Promise<void>, videoPhaseAnchors: string[] = [],
  endPhaseAnchors: string[] = [], endCompareMasks: ScreenshotMask[] = [],
  startPhaseAnchors: string[] = [], startCompareMasks: ScreenshotMask[] = [],
  videoRecorder: typeof recordNativeVideoFrames = recordNativeVideoFrames,
  afterRecording?: () => Promise<void>): Promise<void> {
  /**
   * 截出固定的动画绘制区域。
   * @param bytes - 原生完整屏幕 PNG。
   */
  const crop = (bytes: Buffer) => cropNativeFrame(bytes, region, masks);
  if (masks.length) await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  const beforeScreen = await gameScreenshot(device);
  const beforeNodes = await device.nodes();
  // 旧编排的采样名称仅保留调用兼容；iOS 全部使用视频的空间轨迹校验。
  samplingMethod = 'videoFrames';
  // 使用原分辨率原生视频，截图通道只用于精确端点。
  const recorded = await videoRecorder(device, name, { x: 0, y: 0, ...device.screenSize }, async () => {
    await trigger();
    if (settleMs) await setTimeout(settleMs);
    if (afterReady) await afterReady();
  }, testInfo, 3500, shortAnimationMinimumFrames);
  await afterRecording?.();
  expect(recorded.length, '原生驱动至少采集三帧').toBeGreaterThanOrEqual(3);
  const originals = recorded;
  if (inspectFrames) await inspectFrames(originals, testInfo);
  const afterScreen = await gameScreenshot(device);
  const afterNodes = await device.nodes();
  if (/^(texas-holdem|zhajinhua)-/.test(name)) {
    startCompareMasks = [...startCompareMasks, ...seatGuideBackgroundMasks(beforeNodes, device.screenSize),
      ...beforeNodes.filter(node => node.res === 'leader-board-room-id')
        .map(node => leaderboardRoomIdentityMask(node, device.screenSize))];
    endCompareMasks = [...endCompareMasks, ...seatGuideBackgroundMasks(afterNodes, device.screenSize),
      ...afterNodes.filter(node => node.res === 'leader-board-room-id')
        .map(node => leaderboardRoomIdentityMask(node, device.screenSize))];
  }
  if (startCompareMasks.length) await testInfo.attach(`${name}-start-masks`, {
    body: JSON.stringify(startCompareMasks), contentType: 'application/json',
  });
  if (endCompareMasks.length) await testInfo.attach(`${name}-end-masks`, {
    body: JSON.stringify(endCompareMasks), contentType: 'application/json',
  });
  const selectedRegion = animationRegion(name, beforeNodes, afterNodes, device, region);
  region = selectedRegion.bounds;
  const startMasks = endpointMasksInRegion(startCompareMasks, region);
  const endMasks = endpointMasksInRegion(endCompareMasks, region);
  await testInfo.attach(`${name}-capture-region`, { body: JSON.stringify(selectedRegion), contentType: 'application/json' });
  const before = await crop(beforeScreen);
  const timeline: Buffer[] = [];
  for (const frame of originals) timeline.push(await crop(frame));
  const after = await crop(afterScreen);
  console.log(`IOS > 录屏 ${name}：完成 ${timeline.length} 张遮罩裁图`);
  await testInfo.attach(`${name}-timeline`, {
    body: JSON.stringify(recorded.map((_, index) => recorded.timestampsMs?.[index] ?? null)), contentType: 'application/json',
  });
  for (const [index, frame] of timeline.entries()) {
    if (samplingMethod === 'videoFrames' && index % 5 !== 0 && index !== timeline.length - 1) continue;
    await attachFrameEvidence(testInfo, `${name}-frame-${index}`, frame);
  }
  await testInfo.attach(`${name}-start`, { body: before, contentType: 'image/png' });
  await testInfo.attach(`${name}-end`, { body: after, contentType: 'image/png' });
  expect(frameColorDistance(timeline[0], before), '录屏首帧须包含动作前的实际布局').toBeLessThan(10);
  expect(framePaletteDistance(timeline.at(-1)!, after), '录屏结束时动画必须完成').toBeLessThan(10);
  if (requiredRegions.length) {
    const parts = originals.map(frame => cropMotionRegions(frame, requiredRegions, { masks }));
    for (const index of requiredRegions.keys()) {
      expect(parts.some(sample => !samePixels(sample[index], parts[0][index])),
        `${name} 第 ${index + 1} 个区域必须独立运动`).toBe(true);
    }
  }
  const { total, progress, candidates } = await nativeTransitionEvidence(before, after, timeline);
  console.log(`IOS > 录屏 ${name}：完成轨迹分析，${candidates.length} 张中间帧`);
  expect(total, '入口点击必须产生足够大的可见变化').toBeGreaterThan(3);
  expect(frameColorDistance(timeline[0], before), '录屏首帧必须更接近起点，不能只有动作后的画面')
    .toBeLessThan(frameColorDistance(timeline[0], after));
  // BottomSheet 的弹簧轨迹可能越过终点；用“同时区别于首尾”选关键帧。
  await testInfo.attach(`${name}-progress`, {
    body: JSON.stringify({ total, frames: progress }),
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
    expect([`${name}-start.png`, ...startPhaseAnchors.filter(file => existsSync(baselinePath(file)))]
      .some(file => {
        const reference = readFileSync(baselinePath(file));
        return name === 'native-launch-and-staging-notice'
          ? reviewedLauncherStart(before, reference)
          : samePixels(maskScreenshot(before, startMasks),
            maskScreenshot(reference, startMasks));
      }), '动画起点视觉回归').toBe(true);
    expect([`${name}-end.png`, ...endPhaseAnchors.filter(file => existsSync(baselinePath(file)))]
      .some(file => samePixels(maskScreenshot(after, endMasks),
        maskScreenshot(readFileSync(baselinePath(file)), endMasks))),
    '动画终点视觉回归').toBe(true);
    const reference = readFileSync(baselinePath(`${name}-middle.png`));
    // 原生截图可能落在已审查中途相位的两侧，但靠近起止帧的无关闪屏不能冒充转场。
    // 非录屏路径要求基准变化幅度；录屏路径在空间匹配时逐个检查已审查相位。
    const anchors = [reference, ...videoPhaseAnchors.filter(file => existsSync(baselinePath(file))).map(file => readFileSync(baselinePath(file)))];
    await testInfo.attach(`${name}-reviewed-middle-comparison`, {
      body: JSON.stringify({
        // Pixel distance is not opacity or elapsed animation percentage.
        metric: 'normalized-pixel-distance-not-opacity',
        candidates: candidates.map(({ index, progress, remaining }) => ({
          index, timestampMs: recorded.timestampsMs?.[index] ?? null, progress, remaining,
        })),
        ...reviewedVideoMiddleEvidence(before, after, candidates, anchors),
      }),
      contentType: 'application/json',
    });
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
    await attachFrameEvidence(testInfo, `${name}-frame-${index}`, frame);
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
      const reference = readFileSync(baselinePath(file));
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
    else if (phase === 'start' || phase === 'end') expect(samePixels(frame, readFileSync(baselinePath(file)))).toBe(true);
    else {
      const reference = readFileSync(baselinePath(file));
      expect(Math.min(...visible.map(candidate => frameColorDistance(candidate, reference))),
        `${name} ${phase} 视觉回归`).toBeLessThanOrEqual(12);
    }
  }
}
