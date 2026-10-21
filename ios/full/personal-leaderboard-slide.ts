import type { NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { nativePersonalLeaderboardBounds } from './animation-region';
import { decodeFrame, type FramePixels } from './native-frame';

export type LeaderboardSlideLayout = {
  panel: ScreenshotBounds;
  close: ScreenshotBounds;
};

export function leaderboardSlideLayout(
  nodes: NativeNode[],
  screen: { width: number; height: number },
  region: ScreenshotBounds
): LeaderboardSlideLayout {
  const expected = nativePersonalLeaderboardBounds(nodes, screen);
  if (
    Object.keys(expected).some(
      (key) => expected[key as keyof ScreenshotBounds] !== region[key as keyof ScreenshotBounds]
    )
  )
    throw new Error('个人排行榜滑入必须验证完整原生侧栏');
  const controls = nodes.filter(
    (node) => node.res === 'personal-leader-board-close-button' && node.visible !== false
  );
  if (controls.length !== 1) throw new Error('个人排行榜必须有唯一可见关闭按钮');
  const close = controls[0].bounds;
  if (
    close.width <= 0 ||
    close.height <= 0 ||
    Math.abs(close.width - close.height) > 3 ||
    close.x < region.width * 0.6 ||
    close.x + close.width > region.width ||
    close.y < region.height * 0.75 ||
    close.y + close.height > region.height
  )
    throw new Error('个人排行榜关闭按钮必须位于原生侧栏底部');
  return {
    panel: { x: 0, y: 0, width: region.width, height: region.height },
    close: { ...close },
  };
}

const color = (frame: FramePixels, x: number, y: number): number[] => {
  const offset = (Math.round(y) * frame.width + Math.round(x)) * 4;
  return [frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]];
};
const distance = (a: number[], b: number[]) =>
  a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / 3;

/** PersonalLeaderBoard uses slideInLeft with no size change. Require both the
 * full-height right boundary and its static close icon to translate together.
 * Nickname/statistics loading at the completed position cannot pass.
 */
export async function leaderboardSlideEvidence(
  before: Buffer,
  after: Buffer,
  frames: Buffer[],
  candidateIndices: number[],
  layout: LeaderboardSlideLayout
) {
  const [start, end] = await Promise.all([decodeFrame(before), decodeFrame(after)]);
  const { panel, close } = layout;
  if (
    start.width !== end.width ||
    start.height !== end.height ||
    end.width !== panel.width ||
    end.height !== panel.height
  )
    throw new Error('个人排行榜滑入图像必须保持完整原生尺寸');
  const features = Array.from({ length: 225 }, (_, index) => {
    const x = close.x + (close.width * ((index % 15) + 1)) / 16;
    const y = close.y + (close.height * (Math.floor(index / 15) + 1)) / 16;
    return { x, y, reference: color(end, x, y) };
  });
  const channels = features.flatMap((point) => point.reference);
  const mean = channels.reduce((sum, value) => sum + value, 0) / channels.length;
  if (channels.reduce((sum, value) => sum + Math.abs(value - mean), 0) / channels.length < 15)
    throw new Error('个人排行榜关闭按钮必须有可识别图形');
  const measurements: {
    index: number;
    offset: number | null;
    edgeRatio?: number;
    closeDistance?: number;
  }[] = [];
  for (const index of candidateIndices) {
    const frame = await decodeFrame(frames[index]);
    if (frame.width !== end.width || frame.height !== end.height)
      throw new Error('个人排行榜帧尺寸变化');
    let accepted: (typeof measurements)[number] | undefined;
    // At least 24 px leaves 12 px on each side of the measured moving edge.
    // All evidence remains inside the original full-panel ROI.
    for (let offset = 24; offset <= Math.floor(panel.width / 2); offset++) {
      const boundary = panel.width - offset;
      let valid = 0,
        matches = 0,
        first = 1,
        last = 0;
      for (let row = 1; row <= 49; row++) {
        const fraction = row / 50,
          y = Math.round(panel.height * fraction);
        const foreground = color(end, panel.width - 12, y);
        // The actual ScreenMask is rgba(0,0,0,0.1), not an arbitrary color shift.
        const background = color(start, boundary + 12, y).map((channel) =>
          Math.round(channel * 0.9)
        );
        if (distance(foreground, background) < 24) continue;
        valid++;
        first = Math.min(first, fraction);
        last = Math.max(last, fraction);
        const inside = color(frame, boundary - 12, y),
          outside = color(frame, boundary + 12, y);
        const insideDistance = distance(inside, foreground),
          outsideDistance = distance(outside, background);
        if (
          insideDistance <= 12 &&
          outsideDistance <= 12 &&
          distance(inside, background) >= insideDistance + 12 &&
          distance(outside, foreground) >= outsideDistance + 12
        )
          matches++;
      }
      const edgeRatio = valid >= 12 && last - first >= 0.75 ? matches / valid : 0;
      if (edgeRatio < 0.8) continue;
      const closeDistance =
        features.reduce(
          (sum, point) => sum + distance(color(frame, point.x - offset, point.y), point.reference),
          0
        ) / features.length;
      if (closeDistance > 12) continue;
      accepted = { index, offset, edgeRatio, closeDistance };
      break;
    }
    measurements.push(accepted ?? { index, offset: null });
  }
  return {
    layout,
    measurements,
    candidates: measurements.filter((item) => item.offset !== null).map((item) => item.index),
  };
}
