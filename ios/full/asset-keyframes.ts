import { frameColorDistance } from './animation-transition';

/** Compare playback against its own pre-trigger video frame. Simulator PNG and
 * H.264 have a small colour offset which is not evidence that an asset appeared.
 * Both selected poses must retain at least half of the peak foreground signal;
 * an empty background or almost disappeared effect cannot be the second pose.
 */
export function assetKeyframes(timeline: Buffer[]) {
  if (timeline.length < 2) throw new Error('素材动画缺少原始采样');
  const frames = timeline.map((frame, index) => ({ frame, index,
    distance: frameColorDistance(timeline[0], frame) }));
  const peak = frames.reduce((best, item) => item.distance > best.distance ? item : best);
  if (peak.distance <= 2) throw new Error('素材必须在屏幕上实际出现');
  const visible = frames.filter(item => item.distance > 2 && item.distance >= peak.distance / 2);
  if (visible.length < 2) throw new Error('素材必须有两张仍然可见的播放帧');
  const changed = visible.reduce((best, item) => frameColorDistance(peak.frame, item.frame)
    > frameColorDistance(peak.frame, best.frame) ? item : best);
  if (frameColorDistance(peak.frame, changed.frame) <= 1) throw new Error('素材两张可见播放帧必须实际变化');
  return { peak, changed, visible, distances: frames.map(item => item.distance) };
}
