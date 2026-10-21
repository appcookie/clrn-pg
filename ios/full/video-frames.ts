import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { validateRecordedTimeline, type ProbeFrame } from './video-timeline';
import { recordXCTestVideo } from './xctest-video';

export type RecordedFrames = Buffer[] & { timestampsMs?: number[] };
const runMedia = promisify(execFile);

/** 在真实 Simulator 录屏开始后触发动作，以原始分辨率解码；MP4 永远保留供回看。 */
export async function recordNativeVideoFrames(device: NativeDevice, name: string, region: ScreenshotBounds,
  trigger: () => unknown, testInfo: TestInfo, durationMs = 3500, minimumDistinctFrames = 20,
  onRecorded?: () => Promise<void>): Promise<RecordedFrames> {
  if (!/^[A-Fa-f0-9-]{36}$/.test(device.udid)) throw new Error('录屏需要明确的专用 iOS 模拟器 UUID。');
  const directory = testInfo.outputPath(`video-${name}-${Date.now()}`);
  mkdirSync(directory, { recursive: true });
  const video = path.join(directory, 'capture.mp4');
  // XCTest recordings 39522175718/39527416889 left only edge phases of this
  // 200 ms fade (153 ms between its two relevant encoded frames). Use the
  // Simulator compositor recorder for this specific transition, with the same
  // original timestamps, endpoints and mandatory middle-frame assertions.
  // This is one recording/action, never a fallback after a failed assertion.
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
  const useCompositor = name === 'texas-holdem-raise-bet-enter' || name === 'zhajinhua-leaderboard-enter'
    || /^(?:texas-holdem|zhajinhua)-(?:buy_in|game-record)-enter$/.test(name);
  const backend = useCompositor ? 'simctl' : device.nativeVideoBackend;
  console.log(`IOS > 录屏 ${name}：${backend}`);
  let triggerAt = 0, stoppedAt = 0;
  if (backend === 'xctest') {
    ({ triggerAt, stoppedAt } = await recordXCTestVideo(device, name, trigger, testInfo, video, durationMs));
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
    }
  }
  await testInfo.attach(`${name}-native-video`, { path: video, contentType: 'video/mp4' });
  // Release a held fixture once native recording has stopped, before expensive
  // decoding. The application must not time out while PNGs are processed.
  await onRecorded?.();
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
  console.log(`IOS > 录屏 ${name}：${probe.frames.length} 帧，媒体时长 ${Math.round(timeline.durationMs)} ms`);
  await testInfo.attach(`${name}-encoded-timeline`, { body: JSON.stringify(timeline), contentType: 'application/json' });
  const frames = path.join(directory, 'frames');
  mkdirSync(frames);
  const { x, y, width, height } = region;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > device.screenSize.width || y + height > device.screenSize.height) throw new Error('动画区域必须在原始截图范围内。');
  try {
    await runMedia('ffmpeg', ['-y', '-v', 'error', '-i', video, '-vf',
      `crop=${width}:${height}:${x}:${y}:exact=1`, '-fps_mode', 'passthrough',
      // PNG compression changes file size, never pixels; avoid spending the
      // native test budget compressing temporary full-resolution frame files.
      '-compression_level', '1', path.join(frames, 'frame-%04d.png')], { timeout: 180_000 });
    const files = readdirSync(frames).filter(file => file.endsWith('.png')).sort();
    if (files.length !== timeline.timestampsMs.length) throw new Error('解码帧数与真实录屏时戳不一致。');
    console.log(`IOS > 录屏 ${name}：完成 ${files.length} 张原始帧解码`);
    return Object.assign(files.map(file => readFileSync(path.join(frames, file))), { timestampsMs: timeline.timestampsMs });
  } finally { rmSync(frames, { recursive: true, force: true }); }
}

/** 连续帧使用同一真实视频的编码时戳，不补帧或推算 30fps。 */
export async function recordScreenSamples(device: NativeDevice, name: string, info: TestInfo,
  trigger: () => unknown = () => {}, durationMs = 2500, onRecorded?: () => Promise<void>, minimumDistinctFrames = 20) {
  const frames = await recordNativeVideoFrames(device, name,
    { x: 0, y: 0, ...device.screenSize }, trigger, info, durationMs, minimumDistinctFrames, onRecorded);
  return frames.map((png, index) => ({ capturedAt: frames.timestampsMs![index], png: png.toString('base64') }));
}
