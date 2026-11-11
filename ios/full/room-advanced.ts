import { expect } from '@playwright/test';
import type { NativeNode } from './native-device';
import { fullyInside, nativeViewport } from './native-viewport';

/** RTC 下线不应删除文本/语音消息；末尾截图必须来自真实滚动后的完整页脚。 */
export function assertRoomAdvancedOptions(nodes: NativeNode[], screenSize: { width: number; height: number }) {
  expect(nodes.some(node => node.res === 'base-create-room-screen'), '必须位于建房页面').toBe(true);
  expect(nodes.some(node => node.res === 'allow-player-rtc-switch'), '实时音视频开关已下线').toBe(false);
  for (const role of ['audience', 'player']) {
    for (const kind of ['text', 'voice']) {
      const res = `allow-${role}-${kind}-message-switch`;
      expect(nodes.some(node => node.res === res), `保留消息设置：${res}`).toBe(true);
    }
  }
  const footer = nodes.find(node => node.res === 'create-room-tips-text');
  expect(footer, '建房页脚必须存在').toBeDefined();
  const { node, viewport } = nativeViewport(nodes, footer!, { x: 0, y: 0, ...screenSize });
  expect(node.visible && node.bounds.width > 0 && node.bounds.height > 0
    && fullyInside(node.bounds, viewport), '高级设置截图必须完整显示滚动末尾页脚').toBe(true);
}
