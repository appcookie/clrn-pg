import { flattenNodes, type NativeNode } from './game-controls';
import { playerCountdownNodes } from './game-countdown';
import { foregroundPanels, visibleMasks } from './game-masks';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

/** The former 600/720-width crop cut the right end of the winning banner.
 * Keep its complete native container, all public cards, and both positions of
 * the self player's cards/strength bar while they move during showdown.
 */
export function texasShowdownRegion(before: NativeNode[], after: NativeNode[],
  screen: { width: number; height: number }): ScreenshotBounds {
  const banner = after.filter(node => node.res === 'showdown-assist-view-container'
    && node.visible !== false && flattenNodes(node).some(child =>
      child.res === 'showdown-assist-view-strength-text' && Boolean(child.text)));
  if (banner.length !== 1) throw new Error('摊牌必须有唯一完整原生获胜横幅');
  const bounds: ScreenshotBounds[] = [banner[0].bounds];
  for (const nodes of [before, after]) {
    const publicCards = nodes.filter(node => node.res === 'community_card' && node.visible !== false);
    if (publicCards.length !== 5) throw new Error('摊牌必须保留五张完整公共牌');
    const self = nodes.filter(node => node.visible !== false
      && node.res?.startsWith('texas-holdem-player-container-')
      && flattenNodes(node).some(child => child.res === 'texas-holdem-self-seated-marker'));
    if (self.length !== 1) throw new Error('摊牌必须有唯一本人原生玩家容器');
    const cards = nodes.flatMap(flattenNodes).filter(node =>
      node.res === 'texas-holdem-player-hole-cards' || node.res === 'player_card'
      || node.res === 'texas-holdem-hand-card-strength-text'
      || node.res?.endsWith('/img_hand_card_hot_bar@3x.png'));
    bounds.push(...publicCards.map(node => node.bounds), self[0].bounds, ...cards.map(node => node.bounds));
  }
  if (bounds.some(b => b.width <= 0 || b.height <= 0 || b.x < 0 || b.y < 0
    || b.x + b.width > screen.width || b.y + b.height > screen.height)) {
    throw new Error('摊牌控件必须完整位于原生屏幕内');
  }
  // Opponents' small folded/back cards above the public row do not participate
  // in this showdown. Include only cards at or below the five public cards.
  const top = Math.min(...before.filter(node => node.res === 'community_card').map(node => node.bounds.y));
  const selected = bounds.filter(b => b.y + b.height > top);
  const x = Math.max(0, Math.min(...selected.map(b => b.x)) - 4);
  const y = Math.max(0, Math.min(...selected.map(b => b.y)) - 4);
  return { x, y, width: Math.min(screen.width, Math.max(...selected.map(b => b.x + b.width)) + 4) - x,
    height: Math.min(screen.height, Math.max(...selected.map(b => b.y + b.height)) + 4) - y };
}

/** Dynamic clocks belong to the starting table, not to the fire or winning
 * banner. Exclude them only for endpoint comparison; never mask video frames
 * or punch through revealed cards/the banner.
 */
export function texasEffectEndpointMasks(name: string, nodes: NativeNode[],
  screen: { width: number; height: number }): ScreenshotMask[] {
  const panels = foregroundPanels(nodes, screen);
  if (name === 'texas-all-in-fire') return playerCountdownNodes(nodes, 'texas-holdem').flatMap(node =>
    visibleMasks({ ...node.bounds, reason: '全压端点的独立玩家秒数；火焰及原片不遮罩' }, node, panels));
  if (name !== 'texas-showdown') return [];
  return nodes.filter(node => node.res === 'countdown-text' && node.visible !== false
    && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(node.text || '')).flatMap(node =>
    visibleMasks({ x: node.bounds.x - 2, y: node.bounds.y - 2,
      width: node.bounds.width + 4, height: node.bounds.height + 4,
      reason: '摊牌端点的独立牌局时钟；完整获胜横幅及原片不遮罩' }, node, panels));
}
