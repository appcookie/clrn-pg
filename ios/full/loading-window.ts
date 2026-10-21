import { frameColorDistance } from './animation-transition';
import { cropNativeFrame } from './motion-regions';
import type { ScreenshotBounds } from './screenshot';

/** 用原生加载文字的真实像素定位连续录像后段；保留原始帧和编码时戳。 */
export async function loadingWindow<T extends { capturedAt: number; png: string }>(
  frames: T[], before: Buffer, loaded: Buffer, label: ScreenshotBounds,
): Promise<{ frames: T[]; first: number }> {
  const reference = await cropNativeFrame(loaded, label);
  if (frameColorDistance(await cropNativeFrame(before, label), reference) <= 15) {
    throw new Error('加载文字必须与请求前画面明确不同');
  }
  const matches: boolean[] = [];
  for (const frame of frames) {
    matches.push(frameColorDistance(await cropNativeFrame(Buffer.from(frame.png, 'base64'), label), reference) <= 10);
  }
  const first = matches.findIndex(Boolean);
  if (first < 0 || matches.slice(first).some(match => !match)) {
    throw new Error('加载文字必须连续保留到录屏末尾，不能夹入预热或超时画面');
  }
  const selected = frames.slice(first);
  if (selected.length < 10 || selected.at(-1)!.capturedAt - selected[0].capturedAt < 1500) {
    throw new Error('真实加载画面必须包含至少十帧及一个完整旋转周期');
  }
  return { frames: selected, first };
}
