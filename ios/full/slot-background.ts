import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import reference from './slot-head-reference.json' with { type: 'json' };
import type { NativeNode } from './native-device';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

export const slotHeadReference = reference;

/** Keep the original artwork and its actual native layout under regression
 * control before excluding any background through its transparent pixels.
 */
export function verifySlotHeadGeometry(nodes: NativeNode[]): void {
  const head = nodes.find(node => node.res === reference.asset);
  if (!head) throw new Error('老虎机弹窗头部未出现');
  if ((['x', 'y', 'width', 'height'] as const)
    .some(key => head.bounds[key] !== reference.bounds[key])) throw new Error('老虎机头部原生布局偏离已审查基准');
}

export function slotBackgroundMasks(bytes: Buffer, banner: ScreenshotBounds): ScreenshotMask[] {
  if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) {
    throw new Error('老虎机头部素材已变化，必须重新审查，不能沿用背景排除区域');
  }
  const head = PNG.sync.read(bytes);
  if (head.width !== reference.width || head.height !== reference.height) throw new Error('老虎机头部素材尺寸变化');
  return transparentBackgroundMasks(head, reference.bounds, banner);
}

/** Mask the independent banner and its composited antialias fringe.
 * The source SHA and exact native bounds guard the contour itself; opaque
 * foreground beyond a two-source-pixel fringe still compares pixel for pixel.
 */
export function transparentBackgroundMasks(head: PNG, bounds: ScreenshotBounds,
  banner: ScreenshotBounds): ScreenshotMask[] {
  const masks: ScreenshotMask[] = [];
  const background = (x: number, y: number) => {
    const sx = Math.floor((x + 0.5 - bounds.x) * head.width / bounds.width);
    const sy = Math.floor((y + 0.5 - bounds.y) * head.height / bounds.height);
    for (let row = sy - 2; row <= sy + 2; row++) for (let col = sx - 2; col <= sx + 2; col++) {
      if (row < 0 || row >= head.height || col < 0 || col >= head.width
        || head.data[(row * head.width + col) * 4 + 3] !== 255) return true;
    }
    return false;
  };
  const right = Math.ceil(banner.x + banner.width);
  for (let y = Math.floor(banner.y); y < Math.ceil(banner.y + banner.height); y++) {
    let start: number | undefined;
    for (let x = Math.floor(banner.x); x <= right; x++) {
      if (x < right && background(x, y)) { start ??= x; continue; }
      if (start === undefined) continue;
      const width = x - start;
      const previous = masks.find(mask => mask.x === start && mask.width === width && mask.y + mask.height === y);
      if (previous) previous.height++;
      else masks.push({ x: start, y, width, height: 1,
        reason: '独立大厅横幅及2像素合成边缘；头部素材SHA和原生几何严格校验，实心前景仍逐像素比较' });
      start = undefined;
    }
  }
  return masks;
}
