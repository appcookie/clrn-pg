import { decodeFrame, type FramePixels } from './native-frame';
import type { ScreenshotBounds } from './screenshot';

/** 当前原生短提示为顶部浅色横幅；只定位实际像素，文字内容另由所选图片验证。 */
export function toastPanelPixels(frame: FramePixels): ScreenshotBounds | undefined {
  const { width, height, data } = frame;
  let first = -1, last = -1, left = width, right = 0;
  for (let y = 0; y < Math.floor(height / 4); y++) {
    let count = 0, rowLeft = width, rowRight = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] >= 235 && data[i + 1] >= 235 && data[i + 2] >= 235) {
        count++; rowLeft = Math.min(rowLeft, x); rowRight = x;
      }
    }
    if (count > width * 0.6) {
      if (first < 0) first = y;
      last = y; left = Math.min(left, rowLeft); right = Math.max(right, rowRight);
    }
  }
  if (first < 0 || last - first < height * 0.012 || last - first > height * 0.15) return;
  // 保留圆角、边框和阴影；该区域只从已有背景遮罩中减去，不添加任何遮罩。
  const padding = Math.ceil(width / 100), x = Math.max(0, left - padding), y = Math.max(0, first - padding);
  return { x, y, width: Math.min(width, right + padding + 1) - x, height: Math.min(height, last + padding + 1) - y };
}

export async function recordedToastPanel(frames: Buffer[]) {
  const panels: ScreenshotBounds[] = [];
  const frameIndices: number[] = [];
  for (const [index, frame] of frames.entries()) {
    const panel = toastPanelPixels(await decodeFrame(frame));
    if (panel) { panels.push(panel); frameIndices.push(index); }
  }
  if (!panels.length) throw new Error('录像中没有实际可见的提示横幅');
  const x = Math.min(...panels.map(p => p.x)), y = Math.min(...panels.map(p => p.y));
  return { frameIndices, panels, bounds: { x, y, width: Math.max(...panels.map(p => p.x + p.width)) - x,
    height: Math.max(...panels.map(p => p.y + p.height)) - y } };
}
