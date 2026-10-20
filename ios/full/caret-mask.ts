import { PNG } from 'pngjs';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

/**
 * 将真实检测到的细光标平移到键盘收起后的输入框位置。
 * @param caret - 采样时的光标和输入框。
 * @param bounds - 键盘收起后的输入框边界。
 */
export function translateCaret(caret: { mask: ScreenshotMask; input: { bounds: ScreenshotBounds } },
  bounds: ScreenshotBounds): ScreenshotMask {
  return { ...caret.mask, x: caret.mask.x + bounds.x - caret.input.bounds.x,
    y: caret.mask.y + bounds.y - caret.input.bounds.y };
}

/**
 * 仅识别聚焦输入框内细窄的闪烁光标，拒绝遮住文本变化或整行区域。
 * @param before - 前一帧截图。
 * @param after - 后一帧截图。
 * @param bounds - 已确认文字未变化的聚焦输入框边界。
 */
export function caretMask(before: Buffer, after: Buffer,
  bounds: { x: number; y: number; width: number; height: number }): ScreenshotMask | undefined {
  const first = PNG.sync.read(before);
  const second = PNG.sync.read(after);
  if (first.width !== second.width || first.height !== second.height) return;
  let left = first.width, right = -1, top = first.height, bottom = -1;
  for (let y = Math.max(0, bounds.y); y < Math.min(first.height, bounds.y + bounds.height); y++) {
    for (let x = Math.max(0, bounds.x); x < Math.min(first.width, bounds.x + bounds.width); x++) {
      const offset = (y * first.width + x) * 4;
      if (first.data.subarray(offset, offset + 4).equals(second.data.subarray(offset, offset + 4))) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  const width = right - left + 1, height = bottom - top + 1;
  if (width < 1 || width > 6 || height < 12 || height > 80) return;
  return { x: left, y: top, width, height, reason: '输入光标闪烁；输入文字、边框和其余像素仍比较' };
}
