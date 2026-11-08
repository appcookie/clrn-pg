import { flattenNodes, gameSemanticText, type NativeNode } from './game-controls';
import type { ScreenshotBounds } from './screenshot';
import { inside, positiveSize, withinScreen, type Screen } from './texas-animation-geometry';

/** Public cards retain five actual slots across all streets. Crop complete
 * native slots instead of scaled Android offsets that cut the left card edge.
 */
export function nativeCommunityCardRegion(nodes: NativeNode[], street: 'flop' | 'turn' | 'river',
  screen: { width: number; height: number }): ScreenshotBounds {
  const cards = nodes.filter(node => node.res === 'community_card').sort((a, b) => a.bounds.x - b.bounds.x);
  if (cards.length !== 5) throw new Error('必须存在五个当前可见公共牌位');
  cards.forEach((node, index) => validateCommunityCard(node.bounds, cards, index, screen));
  const positions = { flop: cards.slice(0, 3), turn: [cards[3]], river: [cards[4]] };
  const selected = positions[street];
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
  nodes.flatMap(flattenNodes).filter(node => ownCardCandidate(node, p, screen))
    .forEach(node => collectOwnCard(cards, node));
  const pair = [...cards.values()].sort((a, b) => a.bounds.x - b.bounds.x);
  if (pair.length !== 2) throw new Error('本人当前位置必须恰好包含两张手牌');
  const [a, b] = pair.map(item => item.bounds);
  validateOwnPair(a, b);
  const x = Math.max(0, a.x - 4), y = Math.max(0, a.y - 4);
  return { bounds: { x, y, width: Math.min(screen.width, b.x + b.width + 4) - x,
    height: Math.min(screen.height, a.y + a.height + 4) - y }, cards: pair.map(item => item.card) };
}

function validateCommunityCard(b: ScreenshotBounds, cards: NativeNode[], index: number, screen: Screen) {
  const first = cards[0].bounds;
  const aligned = [b.y === first.y, b.height === first.height].every(Boolean);
  const previousRight = index > 0 ? cards[index - 1].bounds.x + cards[index - 1].bounds.width : -Infinity;
  const valid = [positiveSize(b), withinScreen(b, screen), aligned, b.x >= previousRight];
  if (!valid.every(Boolean)) throw new Error('公共牌位必须是屏幕内完整且不重叠的一行');
}
function ownCardCandidate(node: NativeNode, player: ScreenshotBounds, screen: Screen) {
  const area = { x: player.x + player.width, y: player.y,
    width: screen.width - player.x - player.width, height: player.height };
  return [node.res === 'player_card', inside(area, node.bounds),
    node.bounds.y + node.bounds.height <= screen.height].every(Boolean);
}
function collectOwnCard(cards: Map<string, { bounds: ScreenshotBounds; card: string }>, node: NativeNode) {
  const card = gameSemanticText(node, 'player_card_name_text');
  if (!card) return;
  const key = JSON.stringify(node.bounds);
  validateCardIdentity(cards.get(key), card);
  cards.set(key, { bounds: node.bounds, card });
}
function validateCardIdentity(existing: { card: string } | undefined, card: string) {
  if (existing && existing.card !== card) throw new Error('同一手牌位置存在冲突语义');
}
function validateOwnPair(a: ScreenshotBounds, b: ScreenshotBounds) {
  const matching = [a.y === b.y, a.width === b.width, a.height === b.height, Math.abs(a.x + a.width - b.x) <= 4];
  if (!matching.every(Boolean)) throw new Error('两张本人手牌几何不匹配');
}
