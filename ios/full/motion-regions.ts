import { PNG } from 'pngjs';
import type { ScreenshotBounds } from './screenshot';

/** 相位稳定要求每个像素都在编码容差内；不能用全图平均掩盖局部回归。 */
export function samePixels(actual: Buffer, expected: Buffer): boolean {
  const a = PNG.sync.read(actual), b = PNG.sync.read(expected);
  return a.width === b.width && a.height === b.height
    && a.data.every((value, index) => Math.abs(value - b.data[index]) <= 12);
}

/**
 * 将一帧分成互不重叠的动画区域及其补集；每个像素都会进入一个比较分区。
 * 分区只是比较方式，完整原图仍用于基准和报告，不合成不同时间的截图。
 * @param bytes - 已应用普通动态小区域遮罩的实际截图。
 * @param regions - 需要独立匹配闪烁相位的区域。
 */
export function motionParts(bytes: Buffer, regions: ScreenshotBounds[]): { outside: Buffer; regions: Buffer[]; score: number } {
  const picture = PNG.sync.read(bytes);
  const covered = new Uint8Array(picture.width * picture.height);
  let score = 0;
  const parts = regions.map(region => {
    const { x, y, width, height } = region;
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > picture.width || y + height > picture.height) throw new Error('动画比较分区超出实际截图');
    const part = new PNG({ width, height });
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      const pixel = (y + row) * picture.width + x + column;
      if (covered[pixel]) throw new Error('动画比较分区不能重叠');
      covered[pixel] = 1;
      const offset = pixel * 4;
      picture.data.copy(part.data, (row * width + column) * 4, offset, offset + 4);
      score += picture.data[offset + 1];
      picture.data.fill(0, offset, offset + 4);
    }
    return PNG.sync.write(part);
  });
  return { outside: PNG.sync.write(picture), regions: parts, score };
}
