import { flattenNodes, type NativeNode } from './game-controls';
import { playerCountdownNodes } from './game-countdown';
import { foregroundPanels, visibleMasks } from './game-masks';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { positiveSize, withinScreen, paddedRegion, type Screen } from './texas-animation-geometry';

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
  for (const nodes of [before, after]) bounds.push(...showdownCards(nodes));
  validateShowdownBounds(bounds, screen);
  // Opponents' small folded/back cards above the public row do not participate
  // in this showdown. Include only cards at or below the five public cards.
  const top = Math.min(...before.filter(node => node.res === 'community_card').map(node => node.bounds.y));
  const selected = bounds.filter(b => b.y + b.height > top);
  return paddedRegion(selected, screen, 4);
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
  return nodes.filter(showdownClock).flatMap(node =>
    visibleMasks({ x: node.bounds.x - 2, y: node.bounds.y - 2,
      width: node.bounds.width + 4, height: node.bounds.height + 4,
      reason: '摊牌端点的独立牌局时钟；完整获胜横幅及原片不遮罩' }, node, panels));
}

function showdownClock(node: NativeNode) {
  const clock = node.res === 'countdown-text' && node.visible !== false;
  return clock && validClockText(node.text);
}
function validClockText(text: string | undefined) {
  return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text || '');
}
function selfPlayer(node: NativeNode) {
  const player = node.visible !== false && node.res?.startsWith('texas-holdem-player-container-');
  return player;
}
function showdownCard(node: NativeNode) {
  const resource = node.res || '';
  return ['texas-holdem-player-hole-cards', 'player_card', 'texas-holdem-hand-card-strength-text'].includes(resource)
    || resource.endsWith('/img_hand_card_hot_bar@3x.png');
}
function showdownCards(nodes: NativeNode[]) {
  const publicCards = nodes.filter(node => node.res === 'community_card' && node.visible !== false);
  if (publicCards.length !== 5) throw new Error('摊牌必须保留五张完整公共牌');
  const self = nodes.filter(selfPlayer).filter(node => flattenNodes(node)
    .some(child => child.res === 'texas-holdem-self-seated-marker'));
  if (self.length !== 1) throw new Error('摊牌必须有唯一本人原生玩家容器');
  const cards = nodes.flatMap(flattenNodes).filter(showdownCard);
  return [...publicCards.map(node => node.bounds), self[0].bounds, ...cards.map(node => node.bounds)];
}
function validateShowdownBounds(bounds: ScreenshotBounds[], screen: Screen) {
  if (bounds.some(b => !positiveSize(b) || !withinScreen(b, screen)))
    throw new Error('摊牌控件必须完整位于原生屏幕内');
}
