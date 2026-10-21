// 从同一原片选择真实可见的稳定提示，不以提示消失后的背景冒充通过画面。
import { setImmediate } from 'node:timers/promises';
import { cropNativeFrame, samePixels } from './motion-regions';
import { maskScreenshot, type ScreenshotBounds, type ScreenshotMask } from './screenshot';
import type { RecordedFrames } from './video-frames';
import { comparePixels } from '../visual.mjs';

export async function toastKeyframes(frames: RecordedFrames, text: ScreenshotBounds, masks: ScreenshotMask[],
  visibleFrames?: number[]) {
  const times = frames.timestampsMs;
  if (!times || times.length !== frames.length || frames.length < 5
    || times.some((time, index) => !Number.isFinite(time) || time < 0 || (index > 0 && time < times[index - 1])))
    throw new Error('提示录像缺少原始递增时间戳');
  const before = await cropNativeFrame(frames[0], text);
  const after = await cropNativeFrame(frames.at(-1)!, text);
  let reference: Buffer | undefined;
  let referenceLabel: Buffer | undefined;
  let sequence: number[] = [];
  let selected: number[] = [];
  const visible = visibleFrames && new Set(visibleFrames);
  for (let index = 1; index < frames.length - 1; index++) {
    if (visible && !visible.has(index)) { reference = undefined; sequence = []; continue; }
    // 必须区别于前、后背景；所选三帧的实际文字另由离线OCR验证。
    const label = await cropNativeFrame(frames[index], text);
    if (samePixels(label, before) || samePixels(label, after)) {
      reference = undefined; sequence = []; continue;
    }
    const masked = maskScreenshot(frames[index], masks);
    // H.264在静止文字边缘有少量编码噪声；沿用截图12/0.1%规则，
    // 同时独立比较提示区域，不能以大面积背景稀释文字移动或错误。
    if (!reference || !comparePixels(reference, masked).matches || !comparePixels(referenceLabel!, label).matches) {
      reference = masked; referenceLabel = label; sequence = [index];
    } else if (times[index] > times[sequence.at(-1)!]) sequence.push(index);
    if (sequence.length >= 3 && times[index] - times[sequence[0]] >= 250
      && (!selected.length || times[index] - times[sequence[0]] > times[selected.at(-1)!] - times[selected[0]]))
      selected = [...sequence];
    await setImmediate();
  }
  if (!selected.length) throw new Error('提示存在期间全部未遮罩像素必须连续稳定至少 250 毫秒');
  return [selected[0], selected[Math.floor(selected.length / 2)], selected.at(-1)!];
}
