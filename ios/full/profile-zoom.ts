import sharp from 'sharp';
import type { NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { nativeProfilePanelBounds } from './profile-region';
import { decodeFrame, type FramePixels } from './native-frame';

export type ProfileZoomLayout = {
  panel: ScreenshotBounds;
  close: ScreenshotBounds;
};
const contains = (a: ScreenshotBounds, b: ScreenshotBounds) =>
  b.width > 0 &&
  b.height > 0 &&
  b.x >= a.x &&
  b.y >= a.y &&
  b.x + b.width <= a.x + a.width &&
  b.y + b.height <= a.y + a.height;
/** Derive the entire card and its static close icon from the actual endpoint tree.
 * This static icon is independent of the asynchronously loaded avatar and statistics.
 */
export function profileZoomLayout(
  nodes: NativeNode[],
  screen: { width: number; height: number },
  region: ScreenshotBounds
): ProfileZoomLayout {
  const expected = nativeProfilePanelBounds(nodes, screen);
  if (
    Object.keys(expected).some(
      (key) => expected[key as keyof ScreenshotBounds] !== region[key as keyof ScreenshotBounds]
    )
  )
    throw new Error('资料缩放必须验证完整原生卡片');
  const list = nodes.filter(
    (n) => n.res === 'PlayerStatisticComponent_List' && n.visible !== false
  );
  if (list.length !== 1) throw new Error('资料缩放必须有唯一原生统计列表');
  const closes = nodes.filter(
    (n) =>
      n.res === 'player-profile-popup-close' &&
      n.visible !== false &&
      contains(region, n.bounds) &&
      n.bounds.y + n.bounds.height <= list[0].bounds.y
  );
  if (closes.length !== 1) throw new Error('资料缩放必须有唯一面板内关闭图形');
  const a = closes[0].bounds;
  if (
    Math.abs(a.width - a.height) > 3 ||
    a.width < region.width * 0.02 ||
    a.width > region.width * 0.08 ||
    a.x < region.x + region.width * 0.8
  )
    throw new Error('资料关闭图形必须保持原生方形尺寸');
  return {
    panel: { x: 4, y: 4, width: region.width - 8, height: region.height - 8 },
    close: { ...a, x: a.x - region.x, y: a.y - region.y },
  };
}
const color = (frame: FramePixels, x: number, y: number): number[] => {
  const offset =
    (Math.max(0, Math.min(frame.height - 1, Math.round(y))) * frame.width +
      Math.max(0, Math.min(frame.width - 1, Math.round(x)))) *
    4;
  return [frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]];
};
const distance = (a: number[], b: number[]) =>
  a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / 3;

/** A real zoom changes all four card edges around the same center and scales
 * the card's static close icon with them. Loading text, table clipping, a dimmer, and
 * statistics filling an already full-sized card cannot supply this evidence.
 * Pixel tolerance remains the existing native encoding allowance (12).
 */
export async function profileZoomEvidence(
  before: Buffer,
  after: Buffer,
  frames: Buffer[],
  candidateIndices: number[],
  layout: ProfileZoomLayout
) {
  const [start, end] = await Promise.all([decodeFrame(before), decodeFrame(after)]);
  if (
    start.width !== end.width ||
    start.height !== end.height ||
    !contains({ x: 0, y: 0, width: end.width, height: end.height }, layout.panel) ||
    !contains(layout.panel, layout.close)
  )
    throw new Error('资料缩放图像与完整原生布局不一致');
  const p = layout.panel,
    cx = p.x + p.width / 2,
    cy = p.y + p.height / 2;
  const inset = Math.max(6, Math.min(p.width, p.height) * 0.025);
  const edgePoints = ['left', 'right', 'top', 'bottom'].map((side) =>
    Array.from({ length: 21 }, (_, i) => {
      const f = (i + 1) / 22;
      const x =
        side === 'left'
          ? p.x + inset
          : side === 'right'
          ? p.x + p.width - inset
          : p.x + p.width * f;
      const y =
        side === 'top'
          ? p.y + inset
          : side === 'bottom'
          ? p.y + p.height - inset
          : p.y + p.height * f;
      return { x, y, reference: color(end, x, y), side, f };
    })
  );
  const a = layout.close;
  const features = Array.from({ length: 81 }, (_, i) => {
    const x = a.x + (a.width * ((i % 9) + 1)) / 10,
      y = a.y + (a.height * (Math.floor(i / 9) + 1)) / 10;
    return { x, y, reference: color(end, x, y) };
  });
  const channels = features.flatMap((v) => v.reference),
    mean = channels.reduce((s, v) => s + v, 0) / channels.length;
  if (channels.reduce((s, v) => s + Math.abs(v - mean), 0) / channels.length < 15)
    throw new Error('资料关闭图形必须包含真实可识别结构');
  const scaledTemplates = new Map<number, FramePixels>();
  const measurements: {
    index: number;
    scale: number | null;
    edges?: number[];
    closeDistance?: number;
  }[] = [];
  for (const index of candidateIndices) {
    const frame = await decodeFrame(frames[index]);
    if (frame.width !== end.width || frame.height !== end.height)
      throw new Error('资料动画帧尺寸变化');
    let accepted: (typeof measurements)[number] | undefined;
    // zoomIn is 0.3 -> 1 in the pinned App. Require measurable shrink on both
    // axes; no content-only change at the completed scale can pass.
    // A 0.001 step limits center-relative displacement quantization to less
    // than one native pixel at this panel size; integer-percent probes miss
    // small static icons at genuine fractional animation scales.
    for (let step = 300; step <= 960; step++) {
      const scale = step / 1000;
      if ((Math.min(p.width, p.height) * (1 - scale)) / 2 < 12) continue;
      const edges: number[] = [];
      for (const points of edgePoints) {
        let valid = 0,
          matches = 0,
          first = 1,
          last = 0;
        for (const point of points) {
          const x = cx + (point.x - cx) * scale,
            y = cy + (point.y - cy) * scale;
          const ox =
            point.side === 'left'
              ? cx + (p.x - cx) * scale - 8
              : point.side === 'right'
              ? cx + (p.x + p.width - cx) * scale + 8
              : x;
          const oy =
            point.side === 'top'
              ? cy + (p.y - cy) * scale - 8
              : point.side === 'bottom'
              ? cy + (p.y + p.height - cy) * scale + 8
              : y;
          // ScreenMask uses rgba(0, 0, 0, 0.1) in the pinned App.
          // Model that specific overlay; do not increase the pixel tolerance.
          const background = color(start, ox, oy).map((channel) => Math.round(channel * 0.9));
          if (distance(background, point.reference) < 24) continue;
          valid++;
          first = Math.min(first, point.f);
          last = Math.max(last, point.f);
          const inside = color(frame, x, y),
            outside = color(frame, ox, oy);
          const foregroundDistance = distance(inside, point.reference),
            backgroundDistance = distance(outside, background);
          if (
            foregroundDistance <= 12 &&
            backgroundDistance <= 12 &&
            distance(inside, background) >= foregroundDistance + 12 &&
            distance(outside, point.reference) >= backgroundDistance + 12
          )
            matches++;
        }
        const ratio = valid >= 5 && last - first >= 0.5 ? matches / valid : 0;
        edges.push(ratio);
        if (ratio < 0.8) break;
      }
      if (edges.length !== 4 || edges.some((ratio) => ratio < 0.8)) continue;
      const width = Math.round(p.width * scale),
        height = Math.round(p.height * scale);
      let template = scaledTemplates.get(step);
      if (!template) {
        const { data, info } = await sharp(after)
          .extract({ left: p.x, top: p.y, width: p.width, height: p.height })
          .resize(width, height)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        template = { width: info.width, height: info.height, data };
        scaledTemplates.set(step, template);
      }
      // Compare the close icon at the same raster scale. Point samples of an
      // unscaled high-contrast icon would confuse resampling with a change.
      const left = Math.round(cx - width / 2),
        top = Math.round(cy - height / 2);
      const closeDistance =
        features.reduce((sum, point) => {
          const x = Math.round(((point.x - p.x + 0.5) * width) / p.width - 0.5);
          const y = Math.round(((point.y - p.y + 0.5) * height) / p.height - 0.5);
          return sum + distance(color(frame, left + x, top + y), color(template!, x, y));
        }, 0) / features.length;
      if (closeDistance > 12) continue;
      accepted = { index, scale, edges, closeDistance };
      break;
    }
    measurements.push(accepted ?? { index, scale: null });
  }
  return {
    layout,
    measurements,
    candidates: measurements.filter((item) => item.scale !== null).map((item) => item.index),
  };
}
