import { flattenNodes, gameSemanticText, type NativeNode } from './game-controls';
import type { ScreenshotBounds } from './screenshot';

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
