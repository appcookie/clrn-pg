import type { TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import { gameTapCurrent } from './game-controls';
import { slotBannerSpinPoint } from './slot-regions';

/** 录屏启动后重新确认横幅的真实位置，只点击一次并保存落点和时序。 */
export async function pressSlotBanner(device: NativeDevice, info: Pick<TestInfo, 'attach'>): Promise<void> {
  const preparedAt = new Date().toISOString();
  let tap: { x: number; y: number; requestedAt: string } | undefined;
  try {
    await gameTapCurrent(device, 'slot-banner', slotBannerSpinPoint, point => {
      tap = { ...point, requestedAt: new Date().toISOString() };
    });
  } finally {
    await info.attach('slot-banner-tap', { contentType: 'application/json',
      body: JSON.stringify({ preparedAt, tap, completedAt: new Date().toISOString() }) });
  }
}
