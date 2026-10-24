import { expect } from '@playwright/test';
import type { NativeDevice, NativeNode } from './native-device';
import { nativeChatPanelBounds } from './animation-region';

/** Keep the endpoint tree that actually contains the complete native chat
 * sheet. A transient partial XCTest snapshot must not be used as its layout.
 * This only waits for the endpoint; it never repeats the action or recording.
 */
export async function chatEndpointNodes(device: Pick<NativeDevice, 'nodes' | 'screenSize'>): Promise<NativeNode[]> {
  let observed: NativeNode[] = [];
  await expect.poll(async () => {
    observed = await device.nodes();
    try { nativeChatPanelBounds(observed, device.screenSize); return true; }
    catch (error) {
      if (error instanceof Error && /^(聊天面板缺少可见控件|找不到完整聊天原生面板)/.test(error.message)) return false;
      throw error;
    }
  }, { timeout: 30_000, intervals: [250] }).toBe(true);
  return observed;
}
