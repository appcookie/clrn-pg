// 从同一原片选择真实可见的稳定提示，不以提示消失后的背景冒充通过画面。
import { setImmediate } from 'node:timers/promises';
import { cropNativeFrame, samePixels } from './motion-regions';
import { maskScreenshot, type ScreenshotBounds, type ScreenshotMask } from './screenshot';
import type { RecordedFrames } from './video-frames';

export async function toastKeyframes(frames: RecordedFrames, text: ScreenshotBounds, masks: ScreenshotMask[]) {
  const times = frames.timestampsMs;
  if (!times || times.length !== frames.length || frames.length < 5
    || times.some((time, index) => !Number.isFinite(time) || time < 0 || (index > 0 && time < times[index - 1])))
    throw new Error('提示录像缺少原始递增时间戳');
  const before = await cropNativeFrame(frames[0], text);
  const after = await cropNativeFrame(frames.at(-1)!, text);
  let reference: Buffer | undefined;
  let sequence: number[] = [];
  let selected: number[] = [];
  for (let index = 1; index < frames.length - 1; index++) {
    // 语义查询已证实这里显示提示文字；同时要求文字区域区别于前、后背景。
    const label = await cropNativeFrame(frames[index], text);
    if (samePixels(label, before) || samePixels(label, after)) {
      reference = undefined; sequence = []; continue;
    }
    const masked = maskScreenshot(frames[index], masks);
    if (!reference || !samePixels(reference, masked)) {
      reference = masked; sequence = [index];
    } else if (times[index] > times[sequence.at(-1)!]) sequence.push(index);
    if (sequence.length >= 3 && times[index] - times[sequence[0]] >= 250
      && (!selected.length || times[index] - times[sequence[0]] > times[selected.at(-1)!] - times[selected[0]]))
      selected = [...sequence];
    await setImmediate();
  }
  if (!selected.length) throw new Error('提示存在期间全部未遮罩像素必须连续稳定至少 250 毫秒');
  return [selected[0], selected[Math.floor(selected.length / 2)], selected.at(-1)!];
}
