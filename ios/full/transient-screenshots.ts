import { setTimeout as delay } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import type { RecordedFrames } from './video-frames';
import { attachFrameEvidence } from './frame-evidence';

/** Sample actual Simulator PNGs while one short-lived event runs. XCTest's
 * variable-rate MOV can omit almost the entire three-second static prompt.
 * The first image precedes the event; the final sample follows its expiry.
 */
export async function captureTransientScreenshots(device: Pick<NativeDevice, 'screenshot'>,
  name: string, info: Pick<TestInfo, 'attach'>, trigger: () => Promise<string | void>,
  windowMs = 5000, intervalMs = 120): Promise<{ frames: RecordedFrames; result: string | void }> {
  const pictures: Buffer[] = [];
  const capturedAt: number[] = [];
  const take = async () => {
    const started = performance.now();
    const bytes = await device.screenshot();
    pictures.push(bytes);
    capturedAt.push((started + performance.now()) / 2);
  };
  await take();
  const triggeredAt = performance.now();
  const deadline = triggeredAt + windowMs;
  const sampling = (async () => {
    while (performance.now() < deadline) {
      await take();
      if (performance.now() < deadline) await delay(intervalMs);
    }
  })();
  const [sampleResult, actionResult] = await Promise.allSettled([sampling, trigger()]);
  if (sampleResult.status === 'rejected') throw sampleResult.reason;
  const timestampsMs = capturedAt.map(time => time - capturedAt[0]);
  const frames = Object.assign(pictures, { timestampsMs,
    sourceFrameIndices: pictures.map((_, index) => index) }) as RecordedFrames;
  await info.attach(`${name}-screenshot-timeline`, { body: JSON.stringify({
    triggeredAtMs: triggeredAt - capturedAt[0], timestampsMs,
    windowMs, count: pictures.length,
  }), contentType: 'application/json' });
  for (const [index, bytes] of pictures.entries()) {
    await attachFrameEvidence(info, `${name}-screenshot-frame-${index}`, bytes);
  }
  if (actionResult.status === 'rejected') throw actionResult.reason;
  return { frames, result: actionResult.value };
}
