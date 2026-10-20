import { PNG } from 'pngjs';
import type { ScreenshotBounds } from './screenshot';

/** Crop the same original pixels without encoding an unused full-screen complement for every video frame. */
export function cropMotionRegion(bytes: Buffer, region: ScreenshotBounds): Buffer {
  return cropMotionRegions(bytes, [region])[0];
}

/** Decode once for independent reels; do not encode an unused full-screen complement. */
export function cropMotionRegions(bytes: Buffer, regions: ScreenshotBounds[],
  { maxSharedBorder = 0 } = {}): Buffer[] {
  const picture = PNG.sync.read(bytes);
  return regions.map(({ x, y, width, height }, index) => {
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > picture.width || y + height > picture.height) throw new Error('动画比较分区超出实际截图');
    if (regions.slice(0, index).some(other => {
      const w = Math.min(x + width, other.x + other.width) - Math.max(x, other.x);
      const h = Math.min(y + height, other.y + other.height) - Math.max(y, other.y);
      return w > 0 && h > 0 && (Math.min(w, h) > maxSharedBorder
        || w * h >= Math.min(width * height, other.width * other.height));
    })) throw new Error('动画比较分区不能重叠（仅允许明确声明的原生共享边界）');
    const part = new PNG({ width, height });
    PNG.bitblt(picture, part, x, y, width, height, 0, 0);
    return PNG.sync.write(part);
  });
}

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
