import { flattenNodes, type NativeNode } from './game-controls';
import type { ScreenshotBounds } from './screenshot';
import { inside, paddedRegion } from './zhajinhua-region-geometry';

/** The three opponent cards overlap; XCTest exposes only two wrappers as
 * visible. Keep all current card objects, scoped to each visible player.
 */
export function zhajinhuaCardRegions(nodes: NativeNode[], players: string[],
  screen: { width: number; height: number }): ScreenshotBounds[] {
  const all = [...new Set(nodes.flatMap(flattenNodes))].filter(node => node.res === 'player_card');
  const grouped = players.map(id => {
    const player = nodes.find(n => n.res === `zhajinhua-player-container-${id}`
      || n.res === `zhajinhua-player-container-${id}-operating`);
    if (!player) throw new Error('发牌前必须存在当前可见玩家');
    const p = player.bounds;
    const cardArea = { x: p.x - p.width / 2, y: p.y, width: p.width * 3.5, height: p.height };
    const cards = all.filter(node => inside(node.bounds, cardArea));
    if (cards.length !== 3) throw new Error('每位玩家必须恰好存在三个当前手牌对象');
    return cards;
  });
  if (new Set(grouped.flat()).size !== players.length * 3 || all.length !== players.length * 3) {
    throw new Error('发牌牌位存在重复归属或额外历史牌');
  }
  return grouped.map(cards => paddedRegion(cards.map(n => n.bounds), screen));
}

export function currentZhajinhuaCards(nodes: NativeNode[]): NativeNode[] {
  return [...new Set(nodes.flatMap(flattenNodes))].filter(node => node.res === 'player_card');
}

/** The visible See overlay is omitted from XCTest's flat visible list. Scope
 * its exact marker to the three current own cards before using its tap bounds.
 */
export function zhajinhuaSeeButton(nodes: NativeNode[], ownCards: ScreenshotBounds): NativeNode | undefined {
  const buttons = [...new Set(nodes.flatMap(flattenNodes))].filter(seeButton)
    .filter(node => inside(node.bounds, ownCards));
  if (buttons.length > 1) throw new Error('当前本人手牌不能存在多个看牌按钮');
  return buttons[0];
}

function seeButton(node: NativeNode): boolean {
  return node.res === 'zhajinhua-see-hand-card-button' && eligibleSeeButton(node);
}

function eligibleSeeButton(node: NativeNode): boolean {
  return node.enabled !== false && /^(See|看牌)$/.test(node.text || '');
}
