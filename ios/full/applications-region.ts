import type { NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';

/** The list is inset inside the animated card. Same-edge scroll wrappers can
 * extend below its clipping boundary, so require an outer border on all sides.
 */
export function nativeApplicationsPanelBounds(nodes: NativeNode[],
  screen: { width: number; height: number }): ScreenshotBounds {
  const lists = nodes.filter(node => node.res === 'buy-in-application-list' && node.visible !== false
    && node.bounds.width > 0 && node.bounds.height > 0);
  if (lists.length !== 1) throw new Error('买入申请必须有唯一可见原生列表');
  const list = lists[0].bounds;
  const panel = nodes.filter(node => node.visible !== false && node.clazz === 'XCUIElementTypeOther'
    && node.bounds.x > 0 && node.bounds.y > 0
    && node.bounds.x + node.bounds.width < screen.width
    && node.bounds.y + node.bounds.height < screen.height
    && node.bounds.x < list.x && node.bounds.y < list.y
    && node.bounds.x + node.bounds.width > list.x + list.width
    && node.bounds.y + node.bounds.height > list.y + list.height)
    .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
  if (!panel) throw new Error('买入申请缺少包围列表四边的完整原生卡片');
  const b = panel.bounds, x = Math.max(0, Math.floor(b.x) - 4), y = Math.max(0, Math.floor(b.y) - 4);
  return { x, y, width: Math.min(screen.width, Math.ceil(b.x + b.width) + 4) - x,
    height: Math.min(screen.height, Math.ceil(b.y + b.height) + 4) - y };
}
