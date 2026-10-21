import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';

type Recording = { uuid: string; fps: number; startedAt: number; codec: number; payload?: string };
type Capture = { bytes: Buffer; start: Recording; end: Omit<Recording, 'payload'>;
  triggerAt: number; stoppedAt: number };
const runMedia = promisify(execFile);

/** Always stop and preserve the same recording, including when the UI action fails. */
export async function captureXCTestRecording(device: Pick<NativeDevice, 'execute'>,
  trigger: () => unknown, durationMs: number, preserve: (capture: Capture) => Promise<void>, fps: 30 | 60 = 60) {
  const active = await device.execute('mobile: getXCTestScreenRecordingInfo');
  if (active) throw new Error('XCTest 录屏已在运行，拒绝复用其他动作的录像。');
  let triggerAt = 0, stoppedAt = 0;
  const start: Recording = await device.execute('mobile: startXCTestScreenRecording', { fps });
  try {
    if (!start?.uuid || start.fps !== fps || !Number.isFinite(start.startedAt)) {
      throw new Error(`XCTest 没有确认本轮 ${fps} fps 原生录屏。`);
    }
    // Real CI recordings had a 1.05 s gap after the first encoded frame.
    // Let the native encoder warm up before triggering a short transition.
    // This buffer is not evidence of coverage: real middle-frame checks remain
    // mandatory and will still reject a recording that misses the animation.
    await delay(2000);
    triggerAt = performance.now();
    await trigger();
    await delay(durationMs);
  } finally {
    stoppedAt = performance.now();
    const end: Recording = await device.execute('mobile: stopXCTestScreenRecording');
    if (end?.uuid !== start?.uuid || !end?.payload) throw new Error('XCTest 返回了缺失或不属于本轮的录像。');
    const bytes = Buffer.from(end.payload, 'base64');
    if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('XCTest 原始录像无效。');
    const { payload, ...metadata } = end;
    await preserve({ bytes, start, end: metadata, triggerAt, stoppedAt });
  }
  return { triggerAt, stoppedAt };
}

/** Apple native recording, available in the pinned XCUITest driver on iOS 18.5.
 * Keep the original MOV and remux its video packets without changing frames or rate.
 */
export async function recordXCTestVideo(device: Pick<NativeDevice, 'execute'>, name: string,
  trigger: () => unknown, info: Pick<TestInfo, 'attach'>, video: string, durationMs: number, fps: 30 | 60 = 60) {
  return captureXCTestRecording(device, trigger, durationMs, async ({ bytes, start, end, triggerAt, stoppedAt }) => {
    const original = video.replace(/\.mp4$/, '.mov');
    writeFileSync(original, bytes);
    await info.attach(`${name}-xctest-original`, { path: original, contentType: 'video/quicktime' });
    await runMedia('ffmpeg', ['-y', '-v', 'error', '-i', original,
      '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', video], { timeout: 60_000 });
    await info.attach(`${name}-native-video`, { path: video, contentType: 'video/mp4' });
    await info.attach(`${name}-recorder-process`, { contentType: 'application/json',
      body: JSON.stringify({ backend: 'xctest', uuid: start.uuid, requestedFps: fps,
        actualFps: end.fps, startedAt: start.startedAt, triggerAt, stoppedAt, originalBytes: bytes.length }) });
  }, fps);
}
