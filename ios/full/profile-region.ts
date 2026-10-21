import type { NativeNode } from './native-device';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

/** Keep the full actual profile card: avatar/header, close button and the
 * complete statistics list. The old Android fallback cut off its lower half.
 */
export function nativeProfilePanelBounds(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const controls = ['player-profile-popup-close', 'player-profile-nickname', 'PlayerStatisticComponent_List']
    .map(res => nodes.find(node => node.res === res && node.visible !== false));
  if (controls.some(node => !node)) throw new Error('玩家资料缺少可见关闭按钮、昵称或完整统计列表');
  const panel = nodes.filter(node => node.clazz === 'XCUIElementTypeOther' && node.visible !== false
    && node.bounds.x > 0 && node.bounds.y > 0 && node.bounds.width > 0 && node.bounds.height > 0
    && node.bounds.x + node.bounds.width < screen.width && node.bounds.y + node.bounds.height < screen.height
    && controls.every(control => {
      const a = node.bounds, b = control!.bounds;
      return b.width > 0 && b.height > 0 && b.x >= a.x && b.y >= a.y
        && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
    })).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
  if (!panel) throw new Error('找不到包含资料与统计列表的完整原生卡片');
  const b = panel.bounds, x = Math.max(0, b.x - 4), y = Math.max(0, b.y - 4);
  return { x, y, width: Math.min(screen.width, b.x + b.width + 4) - x,
    height: Math.min(screen.height, b.y + b.height + 4) - y };
}

/** The actual test-account ID is dynamic; only its native one-line label may
 * be excluded from endpoint comparison. Keep the complete raw capture.
 */
export function ownProfileIdentityMask(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotMask[] {
  const panel = nativeProfilePanelBounds(nodes, screen);
  const ids = nodes.filter(node => node.res === 'player-profile-id' && node.visible !== false);
  if (ids.length !== 1) throw new Error('本人资料必须有唯一可见的原生 ID 行');
  const b = ids[0].bounds;
  const protectedMarkers = ['player-profile-nickname', 'player-profile-level', 'player-profile-balance',
    'PlayerStatisticComponent_List', 'player-profile-popup-close'];
  const protectedNodes = protectedMarkers.map(res => nodes.find(node => node.res === res && node.visible !== false));
  if (protectedNodes.some(node => !node)) throw new Error('本人资料 ID 排除前必须保留昵称、等级、余额、统计和关闭按钮');
  if (b.width <= 0 || b.height <= 0 || b.height > screen.height * 60 / 2556
    || b.x < panel.x || b.y < panel.y || b.x + b.width > panel.x + panel.width
    || b.y + b.height > panel.y + panel.height || !/^ID:[ \t]*[0-9a-f-]+$/i.test(ids[0].text || '')
    || /[\r\n]/.test(ids[0].text || '')) {
    throw new Error('本人资料 ID 必须是面板内的单行原生标识');
  }
  if (protectedNodes.some(node => {
    const p = node!.bounds;
    return b.x < p.x + p.width && b.x + b.width > p.x && b.y < p.y + p.height && b.y + b.height > p.y;
  })) throw new Error('本人资料 ID 排除区域不得覆盖其他资料或统计内容');
  return [{ ...b, reason: '本轮实际测试账号 ID；昵称、等级、余额和统计继续比较' }];
}
