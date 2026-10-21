import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import { gameNodes } from './game-controls';
import { playerCountdown } from './game-countdown';
import { recordScreenSamples } from './video-frames';
import { captureMovingKeyframes } from './loop-keyframes';
import { cropNativeFrame } from './motion-regions';
import { PNG } from 'pngjs';

/** The native countdown is yellow or green across real runs of the same room.
 * The recording also starts at different real seconds. Compare the sweep and
 * surrounding layout while the center digits are verified by native semantics;
 * red avatar pixels, gray background, and other hues remain unchanged.
 */
export function countdownShapeDistance(left: Buffer, right: Buffer): number {
  const a = PNG.sync.read(left), b = PNG.sync.read(right);
  if (a.width !== b.width || a.height !== b.height) throw new Error('倒计时帧尺寸变化');
  const normalized = (data: Buffer, offset: number): [number, number, number] => {
    const r = data[offset], g = data[offset + 1], blue = data[offset + 2];
    const saturation = Math.max(r, g, blue) - Math.min(r, g, blue);
    const green = g > r + 35 && g > blue + 35;
    const yellow = r > 140 && g > 110 && blue < g - 35 && Math.abs(r - g) < 120;
    return saturation > 45 && (green || yellow) ? [255, 255, 255] : [r, g, blue];
  };
  let difference = 0;
  let comparedPixels = 0;
  const digitTop = Math.floor(a.height * 0.27), digitBottom = Math.ceil(a.height * 0.75);
  for (let offset = 0; offset < a.data.length; offset += 4) {
    const y = Math.floor(offset / 4 / a.width);
    if (y >= digitTop && y < digitBottom) continue;
    const first = normalized(a.data, offset), second = normalized(b.data, offset);
    difference += Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1])
      + Math.abs(first[2] - second[2]);
    comparedPixels++;
  }
  return difference / (comparedPixels * 3);
}

/** Start a fresh real 120s clock before recording, after any previous image
 * analysis. Require positive native seconds to decrease as its pixels move.
 */
export async function capturePlayerCountdown(device: NativeDevice, game: 'texas-holdem' | 'zhajinhua',
  playerId: string, info: TestInfo, refresh: () => Promise<void>): Promise<void> {
  await refresh();
  let before: ReturnType<typeof playerCountdown> | undefined;
  await expect(async () => {
    before = playerCountdown(await gameNodes(device), playerId, game);
    expect(before.seconds, '本轮计时事件必须已经开始').toBeGreaterThan(60);
  }).toPass({ timeout: 30_000, intervals: [250] });
  const name = `${game === 'texas-holdem' ? 'texas' : game}-operation-countdown`;
  const frames = await recordScreenSamples(device, name, info, undefined, 3000, async () => {
    const after = playerCountdown(await gameNodes(device), playerId, game);
    expect(after.node.bounds, '倒计时须保持在同一个玩家位置').toEqual(before!.node.bounds);
    expect(after.seconds, '录像期间真实倒计时必须递减').toBeLessThan(before!.seconds);
    await info.attach(`${name}-seconds`, {
      body: JSON.stringify({ before: before!.seconds, after: after.seconds }), contentType: 'application/json',
    });
  });
  const firstSweep = await cropNativeFrame(Buffer.from(frames[0].png, 'base64'), before!.node.bounds);
  const lastSweep = await cropNativeFrame(Buffer.from(frames.at(-1)!.png, 'base64'), before!.node.bounds);
  expect(countdownShapeDistance(firstSweep, lastSweep), '倒计时扇形自身必须真实运动').toBeGreaterThan(2);
  await captureMovingKeyframes(device, name, info, [before!.node.bounds], 20, countdownShapeDistance, 1, [], frames);
}
