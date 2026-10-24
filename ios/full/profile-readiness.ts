import { expect } from '@playwright/test';
import type { NativeNode } from './game-controls';
import type { ScreenshotBounds } from './screenshot';
import type { NativeDevice } from './native-device';

/** Read the real visible statistics row from the complete post-recording tree.
 * Direct element lookup returned absence during run 39543731649 while its
 * original video and subsequent full tree both showed the correct statistics.
 */
export function profileReadiness(nodes: NativeNode[], screen: { width: number; height: number }) {
  const unique = (res: string) => {
    const found = nodes.filter(node => node.res === res);
    expect(found, `${res} 必须唯一`).toHaveLength(1);
    expect(found[0].visible, `${res} 必须原生可见`).toBe(true);
    return found[0];
  };
  const contains = (outer: ScreenshotBounds, inner: ScreenshotBounds) => inner.width > 0 && inner.height > 0
    && inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
  const list = unique('PlayerStatisticComponent_List');
  const row = unique('PlayerStatisticComponent_Item_0');
  const balance = unique('player-profile-balance');
  expect(contains({ x: 0, y: 0, ...screen }, list.bounds), '统计列表必须位于当前屏幕').toBe(true);
  expect(contains(list.bounds, row.bounds), '百场统计首行必须位于当前列表').toBe(true);
  expect(contains({ x: 0, y: 0, ...screen }, balance.bounds), '钱包余额必须位于当前屏幕').toBe(true);
  return [row.text, balance.text];
}

/** Retry observations while the asynchronous response renders, never actions. */
export async function waitForProfileReadiness(device: Pick<NativeDevice, 'nodes' | 'screenSize'>,
  expectedBalance: string): Promise<void> {
  await expect(async () => {
    expect(profileReadiness(await device.nodes(), device.screenSize))
      .toEqual(['Total Hands, 100', expectedBalance]);
  }).toPass({ timeout: 45_000, intervals: [250] });
}
