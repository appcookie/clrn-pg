import { flattenNodes, gameSemanticText, type NativeNode } from './game-controls';
import type { ScreenshotBounds } from './screenshot';

/** Public cards retain five actual slots across all streets. Crop complete
 * native slots instead of scaled Android offsets that cut the left card edge.
 */
export function nativeCommunityCardRegion(nodes: NativeNode[], street: 'flop' | 'turn' | 'river',
  screen: { width: number; height: number }): ScreenshotBounds {
  const cards = nodes.filter(node => node.res === 'community_card').sort((a, b) => a.bounds.x - b.bounds.x);
  if (cards.length !== 5) throw new Error('必须存在五个当前可见公共牌位');
  for (const [index, node] of cards.entries()) {
    const b = node.bounds;
    if (b.width <= 0 || b.height <= 0 || b.x < 0 || b.y < 0
      || b.x + b.width > screen.width || b.y + b.height > screen.height
      || b.y !== cards[0].bounds.y || b.height !== cards[0].bounds.height
      || (index > 0 && b.x < cards[index - 1].bounds.x + cards[index - 1].bounds.width)) {
      throw new Error('公共牌位必须是屏幕内完整且不重叠的一行');
    }
  }
  const selected = street === 'flop' ? cards.slice(0, 3) : [cards[street === 'turn' ? 3 : 4]];
  const first = selected[0].bounds, last = selected.at(-1)!.bounds;
  const x = Math.max(0, first.x - 4), y = Math.max(0, first.y - 4);
  return { x, y, width: Math.min(screen.width, last.x + last.width + 4) - x,
    height: Math.min(screen.height, first.y + first.height + 4) - y };
}

/** XCTest hides the card-flip wrapper while still drawing it. Locate its current
 * geometry beside the visible self player, then require the two semantic cards.
 * The recording separately proves the actual back → intermediate → face pixels.
 */
export function nativeOwnCardRegion(nodes: NativeNode[], self: string,
  screen: { width: number; height: number }): { bounds: ScreenshotBounds; cards: string[] } {
  const player = nodes.find(node => node.res === `texas-holdem-player-container-${self}`
    || node.res === `texas-holdem-player-container-${self}-operating`);
  if (!player) throw new Error('本人可见玩家容器缺失');
  const p = player.bounds;
  const cards = new Map<string, { bounds: ScreenshotBounds; card: string }>();
  for (const node of nodes.flatMap(flattenNodes)) {
    const b = node.bounds;
    if (node.res !== 'player_card' || b.x < p.x + p.width || b.y < p.y
      || b.y + b.height > p.y + p.height || b.x + b.width > screen.width
      || b.y + b.height > screen.height) continue;
    const card = gameSemanticText(node, 'player_card_name_text');
    if (!card) continue;
    const key = JSON.stringify(b);
    if (cards.has(key) && cards.get(key)!.card !== card) throw new Error('同一手牌位置存在冲突语义');
    cards.set(key, { bounds: b, card });
  }
  const pair = [...cards.values()].sort((a, b) => a.bounds.x - b.bounds.x);
  if (pair.length !== 2) throw new Error('本人当前位置必须恰好包含两张手牌');
  const [a, b] = pair.map(item => item.bounds);
  if (a.y !== b.y || a.width !== b.width || a.height !== b.height
    || Math.abs(a.x + a.width - b.x) > 4) throw new Error('两张本人手牌几何不匹配');
  const x = Math.max(0, a.x - 4), y = Math.max(0, a.y - 4);
  return { bounds: { x, y, width: Math.min(screen.width, b.x + b.width + 4) - x,
    height: Math.min(screen.height, a.y + a.height + 4) - y }, cards: pair.map(item => item.card) };
}
