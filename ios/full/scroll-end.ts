// 真实滑动到列表末尾，两次继续滑动后页脚仍保持同一位置。
import { expect } from '@playwright/test';
import type { NativeDevice, NativeSelector } from './native-device';
export async function scrollToEnd(device: NativeDevice, list: NativeSelector, footer: NativeSelector) {
  let previous = '';
  let unchanged = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const { bounds } = await device.info(list);
    await device.input.swipe({ x1: bounds.x + bounds.width * 0.97, y1: bounds.y + bounds.height * 0.85,
      x2: bounds.x + bounds.width * 0.97, y2: bounds.y + bounds.height * 0.2, duration: 600 });
    let settled = '';
    await expect(async () => {
      const { bounds: current } = await device.info(footer);
      const before = settled;
      settled = JSON.stringify(current);
      expect(current.height).toBeGreaterThan(0);
      expect(current.y + current.height).toBeLessThanOrEqual(bounds.y + bounds.height + 2);
      expect(settled).toBe(before);
    }).toPass({ timeout: 10_000, intervals: [300] });
    unchanged = previous === settled ? unchanged + 1 : 0;
    if (unchanged >= 2) return;
    previous = settled;
  }
  throw new Error('滚动后未找到稳定的列表页脚。');
}
