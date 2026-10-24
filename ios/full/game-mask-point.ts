// 在当前原生遮罩内选择远离状态栏、Home 指示条和弹层内容的可点击空白。
import type { ScreenshotBounds } from './screenshot';

export function gameMaskPoint(mask: ScreenshotBounds, panel: ScreenshotBounds,
  screen: { width: number; height: number }): { x: number; y: number } {
  // 基准设备固定 iPhone 16；以其原始截图中的系统栏边界约束可点击区域。
  const left = Math.max(mask.x, 16), right = Math.min(mask.x + mask.width, screen.width - 16);
  const top = Math.max(mask.y, Math.ceil(screen.height * 180 / 2556));
  const bottom = Math.min(mask.y + mask.height, Math.floor(screen.height * 2446 / 2556));
  const regions = [
    { x: left, y: top, width: right - left, height: Math.min(panel.y, bottom) - top },
    { x: left, y: Math.max(top, panel.y + panel.height), width: right - left,
      height: bottom - Math.max(top, panel.y + panel.height) },
    { x: left, y: top, width: Math.min(panel.x, right) - left, height: bottom - top },
    { x: Math.max(left, panel.x + panel.width), y: top,
      width: right - Math.max(left, panel.x + panel.width), height: bottom - top },
  ].filter(region => region.width > 32 && region.height > 32)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  if (!regions.length) throw new Error('遮罩内没有避开系统栏和当前面板的可点击区域。');
  const region = regions[0];
  return { x: Math.round(region.x + region.width / 2), y: Math.round(region.y + region.height / 2) };
}
