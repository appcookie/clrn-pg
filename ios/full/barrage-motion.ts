import { expect, type TestInfo } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import type { NativeDevice } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { gameScreenshot } from './game-controls';
import { cropMotionRegion, cropNativeFrame } from './motion-regions';
import { captureMovingKeyframes, framePaletteDistance } from './loop-keyframes';
import { recordScreenSamples } from './video-frames';
import { animationRecordOnly } from './record-only';

type Sample = { capturedAt: number; png: string };
type Target = { index: number; x: number; y: number; width: number; height: number };

/** 在原生文字所在横带识别新增深绿底、白字弹幕；text 坐标须相对该横带。 */
export async function barrageTargets(before: Buffer, frames: Buffer[], text: ScreenshotBounds): Promise<Target[]> {
  const background = PNG.sync.read(before), targets: Target[] = [];
  for (const [index, bytes] of frames.entries()) {
    const image = PNG.sync.read(bytes);
    if (image.width !== background.width || image.height !== background.height) throw new Error('弹幕横带尺寸变化');
    const foreground = new Uint8Array(image.width * image.height);
    const changed = (offset: number) => [0, 1, 2].some(channel => Math.abs(image.data[offset + channel] - background.data[offset + channel]) > 12);
    for (let pixel = 0; pixel < foreground.length; pixel++) {
      const offset = pixel * 4;
      // App BarrageStyle 使用 Color.navy=#012220；容许视频色彩编码误差，保持原始像素用于最终比较。
      foreground[pixel] = changed(offset) && Math.abs(image.data[offset] - 1) <= 14
        && Math.abs(image.data[offset + 1] - 34) <= 14 && Math.abs(image.data[offset + 2] - 32) <= 14 ? 1 : 0;
    }
    const candidates: Target[] = [];
    for (let seed = 0; seed < foreground.length; seed++) {
      if (!foreground[seed]) continue;
      const queue = [seed]; foreground[seed] = 0;
      let left = image.width, right = -1, top = image.height, bottom = -1;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const pixel = queue[cursor], x = pixel % image.width, y = Math.floor(pixel / image.width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (const adjacent of [x ? pixel - 1 : -1, x + 1 < image.width ? pixel + 1 : -1,
          y ? pixel - image.width : -1, y + 1 < image.height ? pixel + image.width : -1]) {
          if (adjacent >= 0 && foreground[adjacent]) { foreground[adjacent] = 0; queue.push(adjacent); }
        }
      }
      const width = right - left + 1, height = bottom - top + 1;
      if (left <= 0 || right >= image.width - 1 || width < text.width * .8
        || width > text.width + 2 * text.height
        || Math.abs(top + height / 2 - (text.y + text.height / 2)) > Math.max(2, text.height * .1)
        || height < text.height * .8 || height > text.height * 2 || queue.length < width * height * .35) continue;
      let whiteLeft = image.width, whiteRight = -1, whiteTop = image.height, whiteBottom = -1, whites = 0;
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const offset = (y * image.width + x) * 4;
        if (changed(offset) && [0, 1, 2].every(channel => image.data[offset + channel] >= 210)) {
          whites++; whiteLeft = Math.min(whiteLeft, x); whiteRight = Math.max(whiteRight, x);
          whiteTop = Math.min(whiteTop, y); whiteBottom = Math.max(whiteBottom, y);
        }
      }
      if (whites >= 8 && whiteRight - whiteLeft + 1 >= text.width * .6
        && whiteBottom - whiteTop + 1 >= text.height * .45) candidates.push({ index, x: left, y: top, width, height });
    }
    // 该用例只发送一条消息，多个同形前景不应被任意挑选成位移轨迹。
    if (candidates.length === 1) targets.push(candidates[0]);
    // 分帧让出事件循环，牌桌的真实 HTTP/心跳不能被连续 PNG 分析阻塞。
    await delay(0);
  }
  return targets;
}

/** 先录屏再发送一次消息；原生精准观测负责文本语义，原片连通前景负责完整可见与真实左移。 */
export async function captureBarrageMotion(device: NativeDevice, info: TestInfo, send: () => Promise<void>,
  expectedText: string, record = recordScreenSamples): Promise<void> {
  if (animationRecordOnly) {
    await record(device, 'texas-barrage', info, send, 5000);
    return;
  }
  const before = await gameScreenshot(device);
  let marker: Awaited<ReturnType<NativeDevice['transientMarker']>> = null;
  const timing: { phase: string; utc: string }[] = [];
  const mark = (phase: string) => timing.push({ phase, utc: new Date().toISOString() });
  let samples: Sample[];
  try {
    samples = await record(device, 'texas-barrage', info, async () => {
      mark('send-start');
      await send();
      mark('send-complete');
      const deadline = Date.now() + 5000;
      do {
        marker = await device.transientMarker('barrage_text');
        if (marker) break;
        if (Date.now() >= deadline) throw new Error('录屏中必须实际显示弹幕文字');
        await delay(100);
      } while (!marker);
      expect(marker.text, '弹幕必须显示本次准确消息').toBe(expectedText);
      mark('text-observed');
    }, 5000);
  } finally {
    await info.attach('texas-barrage-trigger-timing', { body: JSON.stringify(timing), contentType: 'application/json' });
  }
  expect(marker, '本次原片必须伴随真实原生文字观测').not.toBeNull();
  const bounds = marker!.bounds;
  const region = { x: 0, y: bounds.y - 8, width: device.screenSize.width, height: bounds.height + 16 };
  const empty = cropMotionRegion(before, region);
  const frames: Buffer[] = [];
  for (const sample of samples!) frames.push(await cropNativeFrame(Buffer.from(sample.png, 'base64'), region));
  const targets = await barrageTargets(empty, frames, { ...bounds, y: bounds.y - region.y });
  await info.attach('texas-barrage-target-motion', { body: JSON.stringify({ region, textBounds: bounds, targets }), contentType: 'application/json' });
  expect(targets.length, '同一原片必须包含至少10张完整白字弹幕帧').toBeGreaterThanOrEqual(10);
  const first = targets[0];
  expect(targets.some(target => first.x - target.x >= bounds.width / 2 && Math.abs(first.y - target.y) <= 2),
    '弹幕前景本身必须沿同一横带向左移动至少半个文字宽度').toBe(true);
  const visible = targets.map(target => samples![target.index]);
  await captureMovingKeyframes(device, 'texas-barrage', info, [region], 18,
    framePaletteDistance, 1, ['texas-barrage-1-first-alternate.png'], visible);
}
