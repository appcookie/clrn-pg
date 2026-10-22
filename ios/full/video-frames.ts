import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { validateRecordedTimeline, type ProbeFrame } from './video-timeline';
import { recordXCTestVideo } from './xctest-video';
import { readRecordedFrameFiles } from './video-frame-files';

export type RecordedFrames = Buffer[] & { timestampsMs?: number[]; sourceFrameIndices?: number[] };
const runMedia = promisify(execFile);

/** 在真实 Simulator 录屏开始后触发动作，以原始分辨率解码；MP4 永远保留供回看。 */
export async function recordNativeVideoFrames(device: NativeDevice, name: string, region: ScreenshotBounds,
  trigger: () => unknown, testInfo: TestInfo, durationMs = 3500, minimumDistinctFrames = 20,
  onRecorded?: () => Promise<void>, backendOverride?: 'xctest' | 'simctl'): Promise<RecordedFrames> {
  if (!/^[A-Fa-f0-9-]{36}$/.test(device.udid)) throw new Error('录屏需要明确的专用 iOS 模拟器 UUID。');
  const directory = testInfo.outputPath(`video-${name}-${Date.now()}`);
  mkdirSync(directory, { recursive: true });
  const video = path.join(directory, 'capture.mp4');
  // The original XCTest MOV in 39528661625 also contains a backwards PTS
  // during the ZJH leaderboard entrance (2.793333 -> 2.791667). Recording
  // through the compositor avoids repairing/reordering that invalid media.
  // Buy-in XCTest media 39527425854 captured the menu closing, then jumped
  // directly to the completed 300 ms zoom. Its menu frames are not evidence
  // of the popup's motion; collect that target through the compositor too.
  // Review entrance in 39531480973 skipped 211.7 ms of its 300 ms slide:
  // frames 162/163 only dim the table, then frame 164 has the finished panel.
  // Record this shared transition through the compositor; the target-motion
  // assertion still rejects a capture without a real intermediate panel.
  // Auto-rebuy entrance in 39533568946 reported 60 fps but encoded only six
  // frames, with a 4.12 s gap after the first. The compositor in 39656974916
  // likewise jumped 6.75 s over the entire entrance. Record this short native
  // transition through XCTest at 30 fps while keeping every motion gate.
  // 本轮 39555894478 的牌型退场原始 XCTest MOV 在帧 306→307
  // 出现 7.376667→7.375000 的 PTS 倒退；该动作改用合成器采集。
  const useCompositor = name === 'zhajinhua-leaderboard-enter'
    || name === 'zhajinhua-card-rank-exit'
    // 39690648899 的个人排行榜 XCTest 首帧后仍空 6.65s，完整越过滑入。
    || name === 'texas-holdem-personal-leaderboard-enter'
  // 39560079179's older XCTest profile capture first appeared at full size;
  // retain compositor capture for the two opponent entrances.
    || /^texas-holdem-opponent-profile-[12]-enter$/.test(name)
    || /^(?:texas-holdem|zhajinhua)-(?:buy_in|game-record)-enter$/.test(name);
  // 39573708795 的拼三张菜单合成器原片出现 PTS 倒退；此入口恢复使用
  // 39560084809 已采到 192 帧及 5 个真实中间姿态的 XCTest 录屏。
  // 在动作前固定后端，不重试动作，也不排序或修正失败录像的原始时戳。
  // 摊牌已在应用7aa0902改用原生驱动；39577739591的合成器录像只采到
  // 重叠起步，随后113ms空档越过第二张牌露出的中段。此动作改用XCTest
  // 单次采集，仍须独立证明第二、三张牌身份及水平位移。
  // 加注也已使用原生淡入；39581508021的合成器原片在128→129帧相隔
  // 161.7ms，跳过200ms淡入中段。改用同一固定XCTest采集路径，不改时长。
  // 39597196316 的语音入场合成器原片在 5.873333→5.968333 秒间
  // 从未出现跳到近终点，30 帧中没有面板中间姿态。组件仍保持原生
  // 300ms 动画；改用固定 XCTest 单次采集，保留全部真实运动门禁。
  // 39602805933 的举报退场原片第一、二帧相隔 6.413 秒，完整跨过
  // 弹窗退出。只对此动作选择 XCTest，不补帧或重放关闭动作。
  // 39606839681的语音入场已由XCTest取得6个中间姿态；同轮合成器
  // 退场第14→15帧在21.7ms内直接从完整面板变成牌桌，退场也固定同一后端。
  // 39608277325 的举报入场合成器原片只有9帧且存在5.068秒空档；
  // 39608143748 的德州排行榜入场在第112→113帧跨过1.733秒，
  // 从牌桌直接到完整侧栏。两者改用固定XCTest，保留帧数及目标运动门禁。
  // 应用59ba已把个人榜单切到原生驱动；39625229676 的合成器原片
  // 曾漏过同步侧栏位移。入口重新固定合成器，仍须通过完整目标门禁；
  // 退场继续由 XCTest 30fps 采集。
  // 39659693989 的举报入场合成器原片在触发后相隔358ms，跨过300ms
  // 弹窗滑入；改用固定XCTest单次采集，继续校验已审查的中途轨迹。
  // 39670012835 的本人资料入场合成器在43.136→43.221秒跳过可验证的
  // 0.69～0.92倍缩放；对当前原生驱动改用固定XCTest采样，四边与关闭图形门禁不变。
  // 39683755066 的双人举报入场 60fps XCTest 原片首帧后停顿 3.795s，
  // 只产生 7 帧；按同轮已通过的自动带入录制使用 30fps，运动门禁不变。
  // 39682044700 的操作按钮合成器原片虽有 314 帧，却在弃牌按钮
  // 300ms 入场期间完全跳帧；改用 XCTest 单次录制，逐按钮门禁仍须通过。
  const thirtyFpsRecording = ['texas-holdem-auto-rebuy-enter', 'texas-loading-spinner',
    'texas-holdem-pair-play-report-enter', 'texas-holdem-pair-play-report-exit',
    'texas-holdem-leaderboard-enter', 'zhajinhua-operation-buttons',
    'texas-holdem-personal-leaderboard-exit',
    'texas-holdem-report-enter', 'texas-holdem-own-profile-enter'].includes(name);
  const backend = backendOverride ?? (thirtyFpsRecording || ['zhajinhua-drawer-menu-enter', 'zhajinhua-showdown-cards',
    'texas-holdem-raise-bet-enter', 'texas-holdem-voice-enter', 'texas-holdem-voice-exit',
    'texas-holdem-pair-play-report-enter', 'texas-holdem-pair-play-report-exit',
    ].includes(name) ? 'xctest'
    : useCompositor ? 'simctl' : device.nativeVideoBackend);
  console.log(`IOS > 录屏 ${name}：${backend}`);
  let triggerAt = 0, stoppedAt = 0;
  if (backend === 'xctest') {
    ({ triggerAt, stoppedAt } = await recordXCTestVideo(device, name, trigger, testInfo, video, durationMs,
      // 39616432083 的60fps原片有倒退PTS；只降低此入口的实际采集帧率，
      // 不改应用动画、原始媒体时间戳或真实中途姿态门禁。
      thirtyFpsRecording ? 30 : 60));
  } else {
    const processStartedAt = performance.now();
    const processStartedUtc = new Date().toISOString();
    const recorder = spawn('xcrun', ['simctl', 'io', device.udid, 'recordVideo', '--codec=h264', '--mask=ignored', '--force', video],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', failed: Error | undefined, recordingStartedAt = 0;
    recorder.stderr.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-64 * 1024);
      if (!recordingStartedAt && stderr.includes('Recording started')) recordingStartedAt = performance.now();
    });
    recorder.on('error', error => { failed = error; });
    const finished = new Promise<{ code: number | null; signal: string | null }>(resolve =>
      recorder.once('close', (code, signal) => resolve({ code, signal })));
    try {
      // The first recorded frame took 12.6s on a real CI runner; allow up to 30s.
      for (let attempt = 0; !recordingStartedAt; attempt++) {
        if (failed) throw failed;
        if (recorder.exitCode !== null || attempt >= 300) throw new Error(`iOS 录屏未启动：${stderr}`);
        await delay(100);
      }
      // simctl documents this message as the first processed frame. Actual CI media
      // durations nevertheless differed from wall-clock recording time. This pre-roll
      // is only a buffer; endpoint pixels and intermediate motion must prove coverage.
      await delay(4000);
      if (failed || recorder.exitCode !== null) throw failed ?? new Error(`iOS 录屏提前退出：${stderr}`);
      triggerAt = performance.now();
      await trigger();
      await delay(durationMs);
    } finally {
      stoppedAt = performance.now();
      if (recorder.exitCode === null && recorder.signalCode === null) recorder.kill('SIGINT');
      // simctl drains in-flight frames after SIGINT; CI exceeded the former 60s budget.
      const timeout = setTimeout(() => recorder.kill('SIGKILL'), 180_000);
      const result = await finished;
      clearTimeout(timeout);
      const diagnostic = path.join(directory, 'recording.json');
      let videoBytes = 0;
      try { videoBytes = statSync(video).size; } catch {}
      writeFileSync(diagnostic, JSON.stringify({ processStartedUtc,
        startupMs: recordingStartedAt ? recordingStartedAt - processStartedAt : null,
        recordingMs: recordingStartedAt && recordingStartedAt <= stoppedAt ? stoppedAt - recordingStartedAt : null,
        startedAfterStop: recordingStartedAt > stoppedAt,
        stopMs: performance.now() - stoppedAt, ...result, videoBytes, stderr }, null, 2));
      await testInfo.attach(`${name}-recorder-process`, { path: diagnostic, contentType: 'application/json' });
      if (result.signal === 'SIGKILL' || (result.code !== 0 && result.code !== 130 && result.signal !== 'SIGINT')) {
        throw new Error(`iOS 录屏失败：${stderr}`);
      }
      await testInfo.attach(`${name}-native-video`, { path: video, contentType: 'video/mp4' });
    }
  }
  const processingStartedAt = performance.now();
  const processing: { phase: string; utc: string; elapsedMs: number }[] = [];
  const mark = (phase: string) => {
    const entry = { phase, utc: new Date().toISOString(), elapsedMs: performance.now() - processingStartedAt };
    processing.push(entry);
    console.log(`IOS > 录屏处理 ${name}：${JSON.stringify(entry)}`);
  };
  mark('recording-complete');
  const frames = path.join(directory, 'frames');
  try {
    // Release a held fixture once native recording has stopped, before expensive
    // decoding. The application must not time out while PNGs are processed.
    await onRecorded?.();
    mark('probe-start');
    // The fixture HTTP server shares this Node process. Keep it responsive during
    // long native-video decoding instead of blocking it with execFileSync.
    const { stdout } = await runMedia('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_frames', '-show_entries', 'frame=pts_time', '-of', 'json', video],
    { timeout: 60000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const probe = JSON.parse(stdout) as { frames: ProbeFrame[] };
    await testInfo.attach(`${name}-raw-frame-timestamps`, {
      body: JSON.stringify(probe.frames), contentType: 'application/json',
    });
    const timeline = validateRecordedTimeline(probe.frames, stoppedAt - triggerAt, minimumDistinctFrames);
    mark('probe-complete');
    console.log(`IOS > 录屏 ${name}：${probe.frames.length} 原始帧、${timeline.frameIndices.length} 有效候选，媒体时长 ${Math.round(timeline.durationMs)} ms；排除帧序 ${JSON.stringify(timeline.omittedFrameIndices)}`);
    await testInfo.attach(`${name}-encoded-timeline`, { body: JSON.stringify(timeline), contentType: 'application/json' });
    mkdirSync(frames);
    const { x, y, width, height } = region;
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > device.screenSize.width || y + height > device.screenSize.height) throw new Error('动画区域必须在原始截图范围内。');
    mark('decode-start');
    await runMedia('ffmpeg', ['-y', '-v', 'error', '-i', video, '-vf',
      `crop=${width}:${height}:${x}:${y}:exact=1`, '-fps_mode', 'passthrough',
      // PNG compression changes file size, never pixels; avoid spending the
      // native test budget compressing temporary full-resolution frame files.
      '-compression_level', '1', path.join(frames, 'frame-%04d.png')], { timeout: 180_000 });
    mark('decode-complete');
    const decoded = await readRecordedFrameFiles(frames, probe.frames.length);
    const pictures = timeline.frameIndices.map(index => decoded[index]);
    mark('frames-read');
    const keyframes = [];
    const distinct = timeline.timestampsMs.map((time, index) => ({ time, index }))
      .filter(({ time }, index) => index === 0 || time > timeline.timestampsMs[index - 1]);
    const previewIndices = [distinct[0].index, distinct[Math.floor(distinct.length / 2)].index, distinct.at(-1)!.index];
    for (const [order, index] of previewIndices.entries()) {
      const attachment = `${name}-preview-keyframe-${order + 1}`;
      await testInfo.attach(attachment, { body: pictures[index], contentType: 'image/png' });
      keyframes.push({ attachment, timestampMs: timeline.timestampsMs[index], frameIndex: timeline.frameIndices[index] });
    }
    await testInfo.attach(`${name}-video-preview-keyframes`, {
      body: JSON.stringify(keyframes), contentType: 'application/json',
    });
    console.log(`IOS > 录屏 ${name}：完成 ${pictures.length} 张原始帧解码和读取`);
    return Object.assign(pictures, { timestampsMs: timeline.timestampsMs, sourceFrameIndices: timeline.frameIndices });
  } finally {
    mark('cleanup-start');
    try { await rm(frames, { recursive: true, force: true }); }
    finally {
      mark('cleanup-finished');
      await testInfo.attach(`${name}-processing-timing`, {
        body: JSON.stringify(processing), contentType: 'application/json',
      });
    }
  }
}

/** 连续帧使用同一真实视频的编码时戳，不补帧或推算 30fps。 */
export async function recordScreenSamples(device: NativeDevice, name: string, info: TestInfo,
  trigger: () => unknown = () => {}, durationMs = 2500, onRecorded?: () => Promise<void>,
  minimumDistinctFrames = 20, backendOverride?: 'xctest' | 'simctl') {
  const frames = await recordNativeVideoFrames(device, name,
    { x: 0, y: 0, ...device.screenSize }, trigger, info, durationMs, minimumDistinctFrames,
    onRecorded, backendOverride);
  return frames.map((png, index) => ({ capturedAt: frames.timestampsMs![index], png: png.toString('base64') }));
}
