import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import { gameNodes } from './game-controls';
import { playerCountdown } from './game-countdown';
import { recordScreenSamples } from './video-frames';
import { captureMovingKeyframes } from './loop-keyframes';

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
  await captureMovingKeyframes(device, name, info, [before!.node.bounds], undefined, undefined, 1, [], frames);
}
