import type { NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';

function descendants(node: NativeNode): NativeNode[] {
  return [node, ...(node.children || []).flatMap(descendants)];
}

/** The quick bet zooms beside the acting player's avatar. The historical
 * screen-relative rectangle stops above it on iPhone 16. Include the native
 * black amount panel and its coin, which extends outside that panel.
 */
export function zhajinhuaBetRegion(before: NativeNode[], after: NativeNode[],
  screen: { width: number; height: number }): ScreenshotBounds {
  const acting = before.filter(node => /^zhajinhua-player-container-.+-operating$/.test(node.res || ''));
  if (acting.length !== 1) throw new Error('快捷加注必须有唯一的当前行动玩家');
  const id = acting[0].res!.replace(/-operating$/, '');
  const player = after.find(node => node.res === id || node.res === `${id}-operating`);
  if (!player) throw new Error('快捷加注结束后必须保留当前玩家');
  const panels = descendants(player).filter(node => node.visible !== false
    && node.clazz === 'XCUIElementTypeOther'
    && node.children?.some(child => child.res === 'player_bet_amount_text' && child.text === '40'));
  if (panels.length !== 1) throw new Error('快捷加注必须显示当前玩家的完整 40 筹码面板');
  const panel = panels[0];
  // Fabric can mark the coin as hidden even though its enclosing panel and
  // amount are visible. Keep its geometry only within this exact panel subtree.
  const images = descendants(panel).filter(node => node.clazz === 'XCUIElementTypeImage');
  if (images.length !== 1) throw new Error('快捷加注必须保留原生筹码图标');
  const bounds = [panel.bounds, images[0].bounds];
  if (bounds.some(b => b.width <= 0 || b.height <= 0 || b.x < 0 || b.y < 0
    || b.x + b.width > screen.width || b.y + b.height > screen.height)) {
    throw new Error('快捷加注原生筹码必须完整位于屏幕内');
  }
  const x = Math.max(0, Math.min(...bounds.map(b => b.x)) - 4);
  const y = Math.max(0, Math.min(...bounds.map(b => b.y)) - 4);
  const right = Math.min(screen.width, Math.max(...bounds.map(b => b.x + b.width)) + 4);
  const bottom = Math.min(screen.height, Math.max(...bounds.map(b => b.y + b.height)) + 4);
  return { x, y, width: right - x, height: bottom - y };
}
