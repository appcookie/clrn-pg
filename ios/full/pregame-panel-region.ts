import type { NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';

/** Theme and renewal share the native card layout across both games. Require
 * the complete card around its outermost controls, not an estimated crop.
 */
export function nativePregamePanelBounds(name: 'theme' | 'renew', nodes: NativeNode[],
  screen: { width: number; height: number }): ScreenshotBounds {
  const markers = name === 'theme' ? ['game-settings-close-button',
    'game-settings-card-theme-simple', 'game-settings-card-theme-realistic',
    'game-settings-card-theme-four-color', 'game-settings-card-theme-four-color-two',
    'game-settings-background-green', 'game-settings-background-blue',
    'game-settings-background-purple', 'game-settings-background-black']
    : ['renew-popup-close-button', 'renew-popup-slider', 'renew-popup-cancel-button',
      'renew-popup-confirm-button', 'renew-popup-remain-diamond', 'renew-popup-spend-diamond'];
  const controls = markers.map(marker => {
    const found = nodes.filter(node => node.res === marker && node.visible !== false
      && node.bounds.width > 0 && node.bounds.height > 0);
    if (found.length !== 1) throw new Error(`${name} 面板必须有唯一可见原生控件：${marker}`);
    return found[0];
  });
  const panel = nodes.filter(node => node.visible !== false && node.clazz === 'XCUIElementTypeOther'
    && node.bounds.x > 0 && node.bounds.y > 0
    && node.bounds.x + node.bounds.width < screen.width
    && node.bounds.y + node.bounds.height < screen.height
    && controls.every(control => {
      const a = node.bounds, b = control.bounds;
      return a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width
        && a.y + a.height >= b.y + b.height;
    })).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
  if (!panel) throw new Error(`${name} 面板缺少包含关闭按钮和全部控件的完整原生容器`);
  const b = panel.bounds, x = Math.max(0, b.x - 4), y = Math.max(0, b.y - 4);
  return { x, y, width: Math.min(screen.width, b.x + b.width + 4) - x,
    height: Math.min(screen.height, b.y + b.height + 4) - y };
}

/** The buy-in card enters while the drawer leaves. Its own motion must also be
 * visible in a part of the card that the original drawer never covered.
 */
export function buyInTargetMotionBounds(panel: ScreenshotBounds, before: NativeNode[]): ScreenshotBounds {
  const menu = before.filter(node => node.visible !== false && node.res?.startsWith('drawer-menu-item-')
    && node.bounds.width > 0 && node.bounds.height > 0);
  if (!menu.some(node => node.res === 'drawer-menu-item-exit') || menu.length < 2)
    throw new Error('买入入场必须定位起点的真实原生菜单');
  const left = Math.min(...menu.map(node => node.bounds.x)) - 4;
  const top = Math.min(...menu.map(node => node.bounds.y)) - 4;
  const right = Math.max(...menu.map(node => node.bounds.x + node.bounds.width)) + 4;
  const bottom = Math.max(...menu.map(node => node.bounds.y + node.bounds.height)) + 4;
  const endX = panel.x + panel.width, endY = panel.y + panel.height;
  const parts = [
    { x: panel.x, y: panel.y, width: Math.min(left, endX) - panel.x, height: panel.height },
    { x: Math.max(right, panel.x), y: panel.y, width: endX - Math.max(right, panel.x), height: panel.height },
    { x: panel.x, y: panel.y, width: panel.width, height: Math.min(top, endY) - panel.y },
    { x: panel.x, y: Math.max(bottom, panel.y), width: panel.width, height: endY - Math.max(bottom, panel.y) },
  ].filter(bounds => bounds.width > 0 && bounds.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  if (!parts.length) throw new Error('买入面板没有独立于菜单覆盖范围的可验证区域');
  return parts[0];
}
