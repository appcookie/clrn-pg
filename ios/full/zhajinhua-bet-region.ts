import type { NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { onScreen, paddedRegion } from './zhajinhua-region-geometry';

function descendants(node: NativeNode): NativeNode[] {
  return [node, ...(node.children || []).flatMap(descendants)];
}

/** The quick bet zooms beside the acting player's avatar. The historical
 * screen-relative rectangle stops above it on iPhone 16. Include the native
 * black amount panel and its coin, which extends outside that panel.
 */
export function zhajinhuaBetRegion(before: NativeNode[], after: NativeNode[],
  screen: { width: number; height: number }): ScreenshotBounds {
  const player = actingPlayer(before, after);
  const panel = betPanel(player);
  const image = betCoin(panel);
  const bounds = [panel.bounds, image.bounds];
  if (bounds.some(b => !onScreen(b, screen))) {
    throw new Error('快捷加注原生筹码必须完整位于屏幕内');
  }
  return paddedRegion(bounds, screen);
}

function hasBetAmount(node: NativeNode): boolean | undefined {
  return node.children?.some(child => child.res === 'player_bet_amount_text' && child.text === '40');
}

function actingPlayer(before: NativeNode[], after: NativeNode[]): NativeNode {
  const acting = before.filter(node => /^zhajinhua-player-container-.+-operating$/.test(node.res || ''));
  if (acting.length !== 1) throw new Error('快捷加注必须有唯一的当前行动玩家');
  const id = acting[0].res!.replace(/-operating$/, '');
  const player = after.find(node => node.res === id || node.res === `${id}-operating`);
  if (!player) throw new Error('快捷加注结束后必须保留当前玩家');
  return player;
}

function betPanel(player: NativeNode): NativeNode {
  const panels = descendants(player).filter(node => node.visible !== false
    && node.clazz === 'XCUIElementTypeOther').filter(hasBetAmount);
  if (panels.length !== 1) throw new Error('快捷加注必须显示当前玩家的完整 40 筹码面板');
  return panels[0];
}

function betCoin(panel: NativeNode): NativeNode {
  // Fabric can mark the coin as hidden even though its enclosing panel and
  // amount are visible. Keep its geometry only within this exact panel subtree.
  const images = descendants(panel).filter(node => node.clazz === 'XCUIElementTypeImage');
  if (images.length !== 1) throw new Error('快捷加注必须保留原生筹码图标');
  return images[0];
}
