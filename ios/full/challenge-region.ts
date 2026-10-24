import type { ScreenshotBounds } from './screenshot';

/** 包含原生闪烁图像越过 AX 边界的两像素抗锯齿边缘，仍逐像素比较全部分区。 */
export function challengeRegion(bounds: ScreenshotBounds, screen: { width: number; height: number }): ScreenshotBounds {
  const x = Math.max(0, Math.floor(bounds.x) - 2), y = Math.max(0, Math.floor(bounds.y) - 2);
  return { x, y, width: Math.min(screen.width, Math.ceil(bounds.x + bounds.width) + 2) - x,
    height: Math.min(screen.height, Math.ceil(bounds.y + bounds.height) + 2) - y };
}
