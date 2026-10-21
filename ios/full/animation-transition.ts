import { leaderboardSlideLayout, leaderboardSlideEvidence } from './personal-leaderboard-slide';
import { compareAnimationEndpoint } from './animation-endpoint';
import { chatEndpointNodes } from './chat-readiness';
import { animationRegion, endpointMasksInRegion } from './animation-region';
import { ownProfileIdentityMask } from './profile-region';
import { reviewEndpointNetworkMasks } from './review-endpoint-masks';
import { profileZoomLayout, profileZoomEvidence } from './profile-zoom';
import { assertVisual } from './device';
import { baselinePath } from './baseline-path.mjs';
import { screenBounds } from './screen-geometry';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { NativeDevice as AndroidDevice, NativeNode } from './native-device';
import { gameScreenshot } from './game-controls';
import { cropNativeFrame, cropNativeRegions, cropMotionRegion, samePixels } from './motion-regions';
import { decodeFrame, type FramePixels } from './native-frame';
import { maskScreenshot, maskCroppedScreenshot, type ScreenshotBounds, type ScreenshotMask } from './screenshot';
import { attachFrameEvidence } from './frame-evidence';
import { recordNativeVideoFrames, recordScreenSamples } from './video-frames';
import { alignedVideoDistance, localMotionDistance, mirroredThumbnail, videoThumbnail } from './video-motion';
import { seatGuideBackgroundMasks, leaderboardRoomIdentityMask, networkStatusMask } from './game-masks';
import { shortAnimationMinimumFrames } from './video-timeline';
import { safeNativeTree } from './diagnostics';
import { alertEndpointClockMasks } from './alert-endpoint-masks';
import { nativeLevelUpRegions, type LevelUpRegions } from './level-up-region';
import { buyInTargetMotionBounds } from './pregame-panel-region';
import { zhajinhuaOperationControls, zhajinhuaOperationClockMasks, zhajinhuaChallengeCancel } from './zhajinhua-operation-region';
import { texasActionClockMasks, texasOperationControls, texasPlayerActionMotionBounds,
  texasShortcutMotionBounds } from './texas-action-region';
import { texasRaiseClockMasks, texasRaiseValueMask } from './texas-raise-masks';
import { texasEffectEndpointMasks } from './texas-showdown-region';
import { accurateBetEntrance, accurateBetPanel, accurateBetEndpointMasks, assertAccurateBetRegion } from './zhajinhua-accurate-bet';
import { texasActionStart, compareTexasActionStart } from './texas-action-start';
import { zhajinhuaShowdownLayout, compareShowdownStart, showdownHorizontalEvidence } from './zhajinhua-showdown';

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
    return frameColorDistance(cropMotionRegion(actual, bounds),
      cropMotionRegion(reference, bounds)) <= 2;
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

/** Require motion of the target itself. An outgoing menu or dimmer cannot
 * supply a valid phase of a new panel or control's animation.
 */
export async function nativeTargetMotionEvidence(before: Buffer, after: Buffer, timeline: Buffer[]) {
  const evidence = await nativeTransitionEvidence(before, after, timeline);
  const minimumLocalMotion = Math.max(2.5, localMotionDistance(before, after) * 0.15);
  const localMotionCandidates = evidence.candidates.map(item => ({ index: item.index,
    localMotion: localMotionDistance(before, item.frame) }));
  const accepted = new Set(localMotionCandidates.filter(item => item.localMotion >= minimumLocalMotion)
    .map(item => item.index));
  return { ...evidence, minimumLocalMotion, localMotionCandidates,
    candidates: evidence.candidates.filter(item => accepted.has(item.index)) };
}

/** Keep the native screenshot gate and require a middle phase between the
 * same recording's endpoints. Screenshot/video color shifts and a settled
 * target cannot manufacture an intermediate pose.
 */
export async function nativeRecordedTargetMotionEvidence(before: Buffer, after: Buffer, timeline: Buffer[]) {
  const native = await nativeTargetMotionEvidence(before, after, timeline);
  const recorded = await nativeTargetMotionEvidence(timeline[0], timeline.at(-1)!, timeline);
  const recordedIndices = new Set(recorded.candidates.map(item => item.index));
  return { ...native, recorded, candidates: native.candidates.filter(item => recordedIndices.has(item.index)) };
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
 * @param afterReady - 等待异步面板语义就绪；牌谱和德州资料入场在录屏返回后查询，其他动作继续录制稳定尾段。
 * @param videoPhaseAnchors - 独立绘制层可在不同顺序呈现的额外已审查录屏相位。
 * @param endPhaseAnchors - 手势落点离散化造成的已审查终点画面。
 * @param endCompareMasks - 仅比较终点时排除的独立动态区域，使用原生屏幕坐标；原始终点仍保留。
 * @param startPhaseAnchors - 系统启动器布局不同但均已审查的起点画面。
 * @param startCompareMasks - 仅比较起点时排除的独立动态区域，使用原生屏幕坐标。
 * @param videoRecorder - 可替换的原生录屏采集器，供完整录屏路径回归测试使用。
 * @param afterRecording - 录屏停止后、端点比较前校验静态布局，避免慢速原生树查询阻塞短动画。
 * @param preparedStart - 本次Cancel或精确加注阶段准备刚完成的原生观测；复用语义树而仍当场截取实际起点，避免重复慢查询耗尽操作回合。
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
  afterRecording?: () => Promise<void>,
  preparedStart?: { nodes: NativeNode[]; completedAt: number }): Promise<void> {
  /**
   * 截出固定的动画绘制区域。
   * @param bytes - 原生完整屏幕 PNG。
   */
  const crop = (bytes: Buffer) => cropNativeFrame(bytes, region, masks);
  if (masks.length) await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  if (preparedStart) {
    if (name === 'zhajinhua-operation-buttons') zhajinhuaChallengeCancel(preparedStart.nodes);
    else if (name === 'zhajinhua-accurate-bet-enter') accurateBetEntrance(preparedStart.nodes, device.screenSize);
    else if (name === 'zhajinhua-accurate-bet-exit') accurateBetPanel(preparedStart.nodes, device.screenSize);
    else throw new Error('该动画不允许复用准备观测');
    await testInfo.attach(`${name}-prepared-start-observation`, {
      body: JSON.stringify({ completedAt: preparedStart.completedAt, usedAt: Date.now(),
        nodes: safeNativeTree(preparedStart.nodes) }), contentType: 'application/json',
    });
  }
  const beforeScreen = await gameScreenshot(device);
  const beforeNodes = preparedStart?.nodes ?? await device.nodes();
  // 旧编排的采样名称仅保留调用兼容；iOS 全部使用视频的空间轨迹校验。
  samplingMethod = 'videoFrames';
  const deferredReady = /^(?:texas-holdem|zhajinhua)-game-record-enter$/.test(name)
    || /^texas-holdem-(?:own-profile|opponent-profile-[12])-enter$/.test(name)
    // 39579293828在滑入期间查询昵称时9.6秒只录到17帧。与牌谱/资料卡
    // 一样先保留不受查询打断的录屏，再严格确认业务数据和独立终点。
    || name === 'texas-holdem-personal-leaderboard-enter';
  const endpointStartedAt = performance.now();
  const endpointTiming: { phase: string; utc: string; elapsedMs: number }[] = [];
  const markEndpoint = (phase: string) => endpointTiming.push({ phase, utc: new Date().toISOString(),
    elapsedMs: performance.now() - endpointStartedAt });
  let immediateEndpoint: { nodes: NativeNode[]; screen: Buffer } | undefined;
  // 39583869949的末帧操作按钮仍完整可见、倒计时32秒；解码和整树查询
  // 44秒后才截图已变成0秒。录屏真正停止后立即取独立终点，避免分析耗时
  // 跨越回合；不重发switch_player，也不从录像末帧替代原生截图。
  const observeBeforeDecode = name === 'zhajinhua-operation-buttons' ? async () => {
    markEndpoint('recording-stopped');
    try {
      markEndpoint('nodes-start');
      const nodes = await device.nodes();
      markEndpoint('nodes-complete');
      const screen = await gameScreenshot(device);
      markEndpoint('screenshot-complete');
      immediateEndpoint = { nodes, screen };
    } catch (error) {
      markEndpoint('observation-failed');
      await testInfo.attach(`${name}-endpoint-timing`, {
        body: JSON.stringify(endpointTiming), contentType: 'application/json',
      });
      throw error;
    }
  } : undefined;
  // 使用原分辨率原生视频，截图通道只用于精确端点。
  const recorded = await videoRecorder(device, name, { x: 0, y: 0, ...device.screenSize }, async () => {
    await trigger();
    // A delay measured from the tap cannot establish when the JS-driven panel
    // mounted. Keep these recording windows free of readiness tree queries,
    // then require the same semantics before observing the endpoint.
    if (settleMs) await setTimeout(settleMs);
    if (!deferredReady && afterReady) await afterReady();
  }, testInfo, 3500, shortAnimationMinimumFrames, observeBeforeDecode);
  markEndpoint('recorder-returned');
  const originals = recorded;
  let afterNodes: NativeNode[], afterScreen: Buffer;
  try {
    if (deferredReady && afterReady) {
      markEndpoint('ready-start');
      try {
        await afterReady();
        markEndpoint('ready-complete');
      } catch (error) {
        markEndpoint('ready-failed');
        throw error;
      }
    }
    await afterRecording?.();
    expect(recorded.length, '原生驱动至少采集三帧').toBeGreaterThanOrEqual(3);
    if (inspectFrames) await inspectFrames(originals, testInfo);
    if (observeBeforeDecode) {
      if (!immediateEndpoint) throw new Error('操作按钮录屏必须在解码前读取独立原生终点');
      afterNodes = immediateEndpoint.nodes;
      afterScreen = immediateEndpoint.screen;
    } else {
      markEndpoint('nodes-start');
      afterNodes = /^(?:texas-holdem|zhajinhua)-chat-enter$/.test(name)
        ? await chatEndpointNodes(device) : await device.nodes();
      markEndpoint('nodes-complete');
      afterScreen = await gameScreenshot(device);
      markEndpoint('screenshot-complete');
    }
  } finally {
    await testInfo.attach(`${name}-endpoint-timing`, {
      body: JSON.stringify(endpointTiming), contentType: 'application/json',
    });
  }
  if (name === 'zhajinhua-accurate-bet-enter') accurateBetPanel(afterNodes, device.screenSize);
  if (name === 'zhajinhua-accurate-bet-exit') expect(afterNodes.some(node =>
    node.res === 'accurate-bet-popup-container' && node.visible !== false), '精确加注退场后弹窗必须消失').toBe(false);
  if (/^(?:zhajinhua|texas-holdem)-accurate-bet-(enter|exit)$/.test(name)) {
    startCompareMasks = [...startCompareMasks, ...accurateBetEndpointMasks(beforeNodes)];
    endCompareMasks = [...endCompareMasks, ...accurateBetEndpointMasks(afterNodes)];
  }
  if (name === 'texas-holdem-own-profile-enter') {
    endCompareMasks = [...endCompareMasks, ...ownProfileIdentityMask(afterNodes, device.screenSize)];
  } else if (name === 'texas-holdem-own-profile-exit') {
    startCompareMasks = [...startCompareMasks, ...ownProfileIdentityMask(beforeNodes, device.screenSize)];
  }
  if (/^texas-alert-(?:retry|balance|auth)-enter$/.test(name)) {
    startCompareMasks = [...startCompareMasks, ...alertEndpointClockMasks(beforeNodes)];
  } else if (/^texas-alert-(?:retry|balance|auth)-exit$/.test(name)) {
    endCompareMasks = [...endCompareMasks, ...alertEndpointClockMasks(afterNodes)];
  }
  if (name === 'zhajinhua-operation-buttons') {
    startCompareMasks = [...startCompareMasks, ...zhajinhuaOperationClockMasks(beforeNodes)];
    endCompareMasks = [...endCompareMasks, ...zhajinhuaOperationClockMasks(afterNodes)];
  }
  if (/^texas-(?:operation-buttons|player-action-(?:call|raise|check|fold))$/.test(name)) {
    startCompareMasks = [...startCompareMasks, ...texasActionClockMasks(beforeNodes)];
    endCompareMasks = [...endCompareMasks, ...texasActionClockMasks(afterNodes)];
  }
  if (name === 'texas-holdem-raise-bet-enter' || name === 'texas-raise-slider') {
    startCompareMasks = [...startCompareMasks, ...texasRaiseClockMasks(beforeNodes, device.screenSize)];
    endCompareMasks = [...endCompareMasks, ...texasRaiseClockMasks(afterNodes, device.screenSize),
      ...(name === 'texas-raise-slider' ? texasRaiseValueMask(afterNodes, device.screenSize) : [])];
  }
  if (name === 'texas-all-in-fire' || name === 'texas-showdown') {
    startCompareMasks = [...startCompareMasks, ...texasEffectEndpointMasks(name, beforeNodes, device.screenSize)];
    endCompareMasks = [...endCompareMasks, ...texasEffectEndpointMasks(name, afterNodes, device.screenSize)];
  }
  if (/^(texas-holdem|zhajinhua)-game-record-(enter|exit)$/.test(name)) {
    startCompareMasks = [...startCompareMasks, ...reviewEndpointNetworkMasks(beforeNodes, device.screenSize)];
    endCompareMasks = [...endCompareMasks, ...reviewEndpointNetworkMasks(afterNodes, device.screenSize)];
  }
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
  let selectedRegion: ReturnType<typeof animationRegion>;
  try {
    selectedRegion = animationRegion(name, beforeNodes, afterNodes, device, region);
  } catch (error) {
    // Preserve the exact observations used by the failed assertion. A later
    // failure handler may observe a different accessibility/connection state.
    await testInfo.attach(`${name}-region-observations`, {
      body: JSON.stringify({ before: safeNativeTree(beforeNodes), after: safeNativeTree(afterNodes) }),
      contentType: 'application/json',
    });
    throw error;
  }
  region = selectedRegion.bounds;
  if (/^zhajinhua-accurate-bet-(enter|exit)$/.test(name))
    assertAccurateBetRegion(name.endsWith('-exit') ? beforeNodes : afterNodes, device.screenSize, region);
  const startEndpoint = (bytes: Buffer) => maskCroppedScreenshot(bytes, beforeScreen, startCompareMasks, region);
  const endEndpoint = (bytes: Buffer) => maskCroppedScreenshot(bytes, afterScreen, endCompareMasks, region);
  await testInfo.attach(`${name}-capture-region`, { body: JSON.stringify(selectedRegion), contentType: 'application/json' });
  const before = await crop(beforeScreen);
  const timeline: Buffer[] = [];
  for (const frame of originals) timeline.push(await crop(frame));
  const after = await crop(afterScreen);
  const actionStart = /^texas-player-action-(?:call|raise|check|fold)$/.test(name)
    ? texasActionStart(name, beforeNodes, afterNodes, device.screenSize, region) : undefined;
  const showdown = name === 'zhajinhua-showdown-cards'
    ? zhajinhuaShowdownLayout(beforeNodes, afterNodes, device.screenSize) : undefined;
  const firstStartDistance = actionStart
    ? compareTexasActionStart(timeline[0], before, actionStart).distance
    : showdown ? compareShowdownStart(timeline[0], before, showdown).distance
    : frameColorDistance(timeline[0], before);
  if (actionStart) await testInfo.attach(`${name}-start-alignment`, {
    body: JSON.stringify({ ...actionStart, ...compareTexasActionStart(timeline[0], before, actionStart),
      rawDistance: frameColorDistance(timeline[0], before), threshold: 10,
      scope: 'Only first-frame alignment and exact start baseline; raw motion and full end remain unchanged' }),
    contentType: 'application/json',
  });
  if (showdown) await testInfo.attach(`${name}-start-alignment`, {
    body: JSON.stringify({ ...showdown, ...compareShowdownStart(timeline[0], before, showdown),
      rawDistance: frameColorDistance(timeline[0], before), threshold: 10,
      scope: 'Only start alignment and exact start baseline; original cards and complete end are unmasked' }),
    contentType: 'application/json',
  });
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
  expect(firstStartDistance, '录屏首帧须包含动作前的实际布局').toBeLessThan(10);
  expect(framePaletteDistance(timeline.at(-1)!, after), '录屏结束时动画必须完成').toBeLessThan(10);
  if (requiredRegions.length) {
    const parts: Buffer[][] = [];
    for (const frame of originals) parts.push(await cropNativeRegions(frame, requiredRegions, { masks }));
    for (const index of requiredRegions.keys()) {
      expect(parts.some(sample => !samePixels(sample[index], parts[0][index])),
        `${name} 第 ${index + 1} 个区域必须独立运动`).toBe(true);
    }
  }
  const evidence = await nativeTransitionEvidence(before, after, timeline);
  const { total, progress } = evidence;
  let candidates = evidence.candidates;
  if (showdown) {
    const horizontal = await showdownHorizontalEvidence(before, after, timeline, candidates.map(item=>item.index), showdown);
    await testInfo.attach(`${name}-horizontal-card-motion`, {
      body: JSON.stringify(horizontal), contentType: 'application/json',
    });
    for (const card of horizontal.cards) expect(card.candidates.length,
      `第${card.card}张牌必须有自身牌面真实水平展开，字体加载或其他牌运动不能代替`).toBeGreaterThan(0);
    candidates = candidates.filter(item=>horizontal.middleIndices.includes(item.index));
    expect(candidates.length, '第二与第三张牌必须在同一真实展开中途可见').toBeGreaterThan(0);
  }
  if (/^texas-holdem-(?:own-profile|opponent-profile-[12])-enter$/.test(name)) {
    const layout = profileZoomLayout(afterNodes, device.screenSize, region);
    const zoom = await profileZoomEvidence(before, after, timeline, candidates.map(item => item.index), layout);
    await testInfo.attach(`${name}-profile-zoom`, { body: JSON.stringify(zoom), contentType: 'application/json' });
    const realZoom = new Set(zoom.candidates);
    candidates = candidates.filter(item => realZoom.has(item.index));
    expect(candidates.length, '资料卡四边及静态关闭图形必须有同一次真实缩放中间姿态；重连、数据加载或硬切不能代替')
      .toBeGreaterThan(0);
  }
  if (name === 'texas-holdem-personal-leaderboard-enter') {
    const layout = leaderboardSlideLayout(afterNodes, device.screenSize, region);
    const slide = await leaderboardSlideEvidence(before, after, timeline, candidates.map(item => item.index), layout);
    await testInfo.attach(`${name}-sidebar-slide`, { body: JSON.stringify(slide), contentType: 'application/json' });
    const moved = new Set(slide.candidates);
    candidates = candidates.filter(item => moved.has(item.index));
    expect(candidates.length, '个人排行榜侧栏边界和关闭按钮必须同帧真实平移；昵称或统计加载不能代替滑入')
      .toBeGreaterThan(0);
  }
  if (/^(?:texas-holdem|zhajinhua)-game-record-enter$/.test(name)) {
    const targetEvidence = await nativeTargetMotionEvidence(before, after, timeline);
    await testInfo.attach(`${name}-target-motion`, { body: JSON.stringify({ bounds: region,
      total: targetEvidence.total, progress: targetEvidence.progress,
      minimumLocalMotion: targetEvidence.minimumLocalMotion,
      candidates: targetEvidence.localMotionCandidates }), contentType: 'application/json' });
    const targetIndices = new Set(targetEvidence.candidates.map(item => item.index));
    candidates = candidates.filter(item => targetIndices.has(item.index));
    expect(candidates.length, '牌谱侧栏本身必须有真实滑入中间帧，牌桌遮罩变暗不能冒充').toBeGreaterThan(0);
  }
  if (/^(?:texas-holdem|zhajinhua)-buy_in-enter$/.test(name)) {
    const target = buyInTargetMotionBounds(region, beforeNodes);
    const targetFrames: Buffer[] = [];
    for (const frame of originals) targetFrames.push(await cropNativeFrame(frame, target, masks));
    const targetBefore = await cropNativeFrame(beforeScreen, target, masks);
    const targetAfter = await cropNativeFrame(afterScreen, target, masks);
    const targetEvidence = await nativeTargetMotionEvidence(targetBefore, targetAfter, targetFrames);
    await testInfo.attach(`${name}-target-motion`, { body: JSON.stringify({ bounds: target,
      total: targetEvidence.total, progress: targetEvidence.progress,
      minimumLocalMotion: targetEvidence.minimumLocalMotion,
      candidates: targetEvidence.localMotionCandidates }), contentType: 'application/json' });
    expect(targetEvidence.total, '买入面板自身必须在菜单之外产生明显可见变化').toBeGreaterThan(3);
    const targetIndices = new Set(targetEvidence.candidates.map(item => item.index));
    candidates = candidates.filter(item => targetIndices.has(item.index));
    expect(candidates.length, '买入面板本身必须有真实缩放中间帧，菜单退场不能冒充').toBeGreaterThan(0);
  }
  if (/^texas-player-action-(?:call|raise|check|fold)$/.test(name) || name === 'texas-operation-buttons') {
    const target = name === 'texas-operation-buttons'
      ? texasShortcutMotionBounds(beforeNodes, afterNodes, device.screenSize)
      : texasPlayerActionMotionBounds(name, beforeNodes, afterNodes);
    const targetFrames: Buffer[] = [];
    for (const frame of originals) targetFrames.push(await cropNativeFrame(frame, target, masks));
    const targetEvidence = await nativeTargetMotionEvidence(
      await cropNativeFrame(beforeScreen, target, masks), await cropNativeFrame(afterScreen, target, masks), targetFrames);
    await testInfo.attach(`${name}-target-motion`, { body: JSON.stringify({ bounds: target,
      total: targetEvidence.total, progress: targetEvidence.progress, minimumLocalMotion: targetEvidence.minimumLocalMotion,
      candidates: targetEvidence.localMotionCandidates }), contentType: 'application/json' });
    expect(targetEvidence.total, '新目标独立区域必须产生明显变化').toBeGreaterThan(3);
    const targetIndices = new Set(targetEvidence.candidates.map(item => item.index));
    candidates = candidates.filter(item => targetIndices.has(item.index));
    expect(candidates.length, '目标本身必须有真实中间帧，旧按钮或倒计时消失不能冒充').toBeGreaterThan(0);
  }
  if (name === 'zhajinhua-operation-buttons' || name === 'texas-operation-buttons') {
    const controls = (name === 'texas-operation-buttons' ? texasOperationControls(afterNodes)
      : zhajinhuaOperationControls(afterNodes, device.screenSize))
      .filter(node => name === 'zhajinhua-operation-buttons'
        || /^texas-holdem-operation-button-(raise|fold|call)$/.test(node.res || ''));
    const targetIndices = new Set<number>();
    const perControlCandidates: { marker: string | undefined; indices: number[] }[] = [];
    const newControlPhases = name === 'texas-operation-buttons'
      ? new Set(candidates.map(item => item.index)) : undefined;
    // Each full-resolution frame is decoded once for the non-overlapping
    // controls. All original frames and timestamps remain in the evidence.
    const controlRegions = controls.map(control => control.bounds);
    const starts = await cropNativeRegions(beforeScreen, controlRegions, { masks });
    const ends = await cropNativeRegions(afterScreen, controlRegions, { masks });
    const parts: Buffer[][] = [];
    for (const frame of originals) parts.push(await cropNativeRegions(frame, controlRegions, { masks }));
    for (const [index, control] of controls.entries()) {
      const targetFrames = parts.map(sample => sample[index]);
      const recordedEvidence = name === 'zhajinhua-operation-buttons'
        ? await nativeRecordedTargetMotionEvidence(starts[index], ends[index], targetFrames) : undefined;
      const targetEvidence = recordedEvidence
        ?? await nativeTargetMotionEvidence(starts[index], ends[index], targetFrames);
      await testInfo.attach(`${name}-${control.res}-target-motion`, { body: JSON.stringify({ bounds: control.bounds,
        total: targetEvidence.total, progress: targetEvidence.progress,
        minimumLocalMotion: targetEvidence.minimumLocalMotion,
        candidates: targetEvidence.localMotionCandidates,
        ...(recordedEvidence ? { recorded: {
          total: recordedEvidence.recorded.total, progress: recordedEvidence.recorded.progress,
          minimumLocalMotion: recordedEvidence.recorded.minimumLocalMotion,
          candidates: recordedEvidence.recorded.localMotionCandidates,
          accepted: targetEvidence.candidates.map(item => item.index),
        } } : {}),
      }), contentType: 'application/json' });
      expect(targetEvidence.total, `${control.res} 自身必须产生明显可见变化`).toBeGreaterThan(3);
      if (recordedEvidence) expect(recordedEvidence.recorded.total,
        `${control.res} 同一原片端点必须产生明显可见变化`).toBeGreaterThan(3);
      const controlCandidates = targetEvidence.candidates.filter(item => !newControlPhases || newControlPhases.has(item.index));
      expect(controlCandidates.length, `${control.res} 必须有真实局部中间态，旧控件或选择遮罩退场不能冒充`)
        .toBeGreaterThan(0);
      perControlCandidates.push({ marker: control.res, indices: controlCandidates.map(item => item.index) });
      // The delay button has a continuing highlight animation. It must pass its
      // own gate, but cannot extend the group's entrance beyond the main buttons.
      if (name !== 'zhajinhua-operation-buttons' || /^zhajinhua-operation-button-(battle|fold|call)$/.test(control.res || ''))
        controlCandidates.forEach(item => targetIndices.add(item.index));
    }
    if (name === 'zhajinhua-operation-buttons') {
      await testInfo.attach(`${name}-entrance-window`, { body: JSON.stringify({
        mainControlCandidates: [...targetIndices].sort((a, b) => a - b),
        controls: perControlCandidates.map(control => ({ ...control,
          entranceCandidates: control.indices.filter(index => targetIndices.has(index)) })),
      }), contentType: 'application/json' });
      for (const control of perControlCandidates) expect(control.indices.some(index => targetIndices.has(index)),
        `${control.marker} 必须在主按钮真实入场窗口内运动，后续循环高亮不能代替入场`).toBe(true);
    }
    candidates = candidates.filter(item => targetIndices.has(item.index));
  }
  console.log(`IOS > 录屏 ${name}：完成轨迹分析，${candidates.length} 张中间帧`);
  expect(total, '入口点击必须产生足够大的可见变化').toBeGreaterThan(3);
  expect(firstStartDistance, '录屏首帧必须更接近起点，不能只有动作后的画面')
    .toBeLessThan(actionStart ? compareTexasActionStart(timeline[0], after, actionStart).distance
      : showdown ? compareShowdownStart(timeline[0], after, showdown).distance
      : frameColorDistance(timeline[0], after));
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
          : actionStart ? compareTexasActionStart(before, reference, actionStart).samePixels
          : showdown ? compareShowdownStart(before, reference, showdown).samePixels
          : samePixels(startEndpoint(before), startEndpoint(reference));
      }), '动画起点视觉回归').toBe(true);
    const endpoint = compareAnimationEndpoint(endEndpoint(after),
      [`${name}-end.png`, ...endPhaseAnchors.filter(file => existsSync(baselinePath(file)))]
        .map(file => ({ name: file, bytes: endEndpoint(readFileSync(baselinePath(file))) })));
    await testInfo.attach(`${name}-endpoint-comparison`, {
      body: JSON.stringify({ channelTolerance: 12, maximumChangedRatio: 0.001,
        comparisons: endpoint.comparisons }), contentType: 'application/json',
    });
    if (!endpoint.matches && endpoint.diff) await testInfo.attach(`${name}-endpoint-diff`, {
      body: endpoint.diff, contentType: 'image/png',
    });
    expect(endpoint.matches, '动画终点视觉回归').toBe(true);
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
  const crop = (bytes: Buffer) => cropNativeFrame(bytes, region);
  const before = await crop(await gameScreenshot(device));
  const frames: Buffer[] = [];
  for (const frame of await recordScreenSamples(device, name, testInfo, trigger)) {
    frames.push(await crop(Buffer.from(frame.png, 'base64')));
  }
  expect(frames.length).toBeGreaterThanOrEqual(10);
  await setTimeout(settleMs);
  const after = await crop(await gameScreenshot(device));
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
 * @param trigger - 点击真实按钮以触发提示。
 */
export function timedPromptEvidence(before: Buffer, frames: Buffer[], layout: Pick<LevelUpRegions, 'title' | 'timer'>) {
  const visible = frames.filter(frame => frameColorDistance(before, frame) > 15);
  /**
   * 只截完整提示标题。
   * @param frame - 顶部提示区域的截图。
   */
  const title = (frame: Buffer) => cropMotionRegion(frame, layout.title);
  /**
   * 只截底部秒数，避免把提示滑入误认为倒计时。
   * @param frame - 顶部提示区域的截图。
   */
  const timer = (frame: Buffer) => cropMotionRegion(frame, layout.timer);
  const beforeTitle = title(before);
  const settled = visible.map(frame => ({ frame, heading: title(frame), seconds: timer(frame) }))
    .filter(item => frameColorDistance(beforeTitle, item.heading) > 30);
  let pair: { first: Buffer; changed: Buffer } | undefined;
  for (let index = 0; index < settled.length && !pair; index++) {
    const first = settled[index];
    const changed = settled.slice(index + 1).find(item =>
      frameColorDistance(first.heading, item.heading) < 3
      && frameColorDistance(first.seconds, item.seconds) > 4);
    if (changed) pair = { first: first.frame, changed: changed.frame };
  }
  return { visible, settled: settled.length, pair };
}

export async function captureTimedPrompt(device: AndroidDevice, name: string, testInfo: TestInfo,
  trigger: () => unknown): Promise<void> {
  const nodes = await device.nodes();
  const layout = nativeLevelUpRegions(nodes, device.screenSize, name.startsWith('zhajinhua-') ? 'zhajinhua' : 'texas-holdem');
  const region = layout.panel;
  const endpointMasks = endpointMasksInRegion(nodes.filter(node => node.res === 'ping-screen-container')
    .map(node => networkStatusMask(node.bounds)), region);
  await testInfo.attach(`${name}-capture-regions`, { body: JSON.stringify(layout), contentType: 'application/json' });
  await testInfo.attach(`${name}-endpoint-masks`, { body: JSON.stringify(endpointMasks), contentType: 'application/json' });
  const crop = (bytes: Buffer) => cropNativeFrame(bytes, region);
  const before = await crop(await gameScreenshot(device));
  const frames = await recordNativeVideoFrames(device, name, region, trigger, testInfo);
  expect(frames.length).toBeGreaterThanOrEqual(20);
  expect(framePaletteDistance(before, frames[0]), `${name} 须在采样开始后出现`).toBeLessThan(7);
  const { visible, settled, pair } = timedPromptEvidence(before, frames, layout);
  expect(visible.length, `${name} 须实际显示`).toBeGreaterThanOrEqual(2);
  expect(settled, `${name} 标题须完整出现`).toBeGreaterThanOrEqual(2);
  expect(pair, `${name} 标题稳定后倒计时数字必须变化`).toBeDefined();
  await setTimeout(6000);
  const after = await crop(await gameScreenshot(device));
  expect(samePixels(maskScreenshot(after, endpointMasks), maskScreenshot(before, endpointMasks)),
    `${name} 倒计时结束后须恢复画面`).toBe(true);
  for (const [phase, frame] of [['start', before], ['visible', pair!.first],
    ['countdown', pair!.changed], ['end', after]] as const) {
    const file = `${name}-${phase}.png`;
    await testInfo.attach(file, { body: frame, contentType: 'image/png' });
    if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(frame, file, testInfo);
    else if (phase === 'start' || phase === 'end') expect(samePixels(maskScreenshot(frame, endpointMasks),
      maskScreenshot(readFileSync(baselinePath(file)), endpointMasks))).toBe(true);
    else {
      const reference = readFileSync(baselinePath(file));
      expect(Math.min(...visible.map(candidate => frameColorDistance(candidate, reference))),
        `${name} ${phase} 视觉回归`).toBeLessThanOrEqual(12);
    }
  }
}
