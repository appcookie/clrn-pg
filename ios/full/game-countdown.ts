import { flattenNodes, type NativeNode } from './game-controls';

/** The timer uses pointerEvents=none: XCTest exposes it only under the visible
 * current player. Never search detached historical or offscreen player trees.
 */
export function playerCountdownNodes(nodes: NativeNode[], game: 'texas-holdem' | 'zhajinhua'): NativeNode[] {
  const result = new Map<string, NativeNode>();
  for (const player of nodes.filter(node => node.visible !== false
    && node.res?.startsWith(`${game}-player-container-`))) {
    const p = player.bounds;
    for (const timer of flattenNodes(player).filter(node => node.res === `${game}-active-countdown`)) {
      const b = timer.bounds;
      // ZJH draws its timer three pixels outside the avatar frame.
      const border = game === 'zhajinhua' ? 4 : 0;
      if (b.width <= 0 || b.height <= 0 || b.x < p.x - border || b.y < p.y - border
        || b.x + b.width > p.x + p.width + border || b.y + b.height > p.y + p.height + border) {
        throw new Error('倒计时必须完整位于当前玩家范围内');
      }
      const key = JSON.stringify(b);
      if (!result.has(key)) result.set(key, timer);
    }
  }
  return [...result.values()];
}

export function playerCountdown(nodes: NativeNode[], playerId: string,
  game: 'texas-holdem' | 'zhajinhua'): { node: NativeNode; seconds: number } {
  const players = nodes.filter(node => node.visible !== false
    && node.res === `${game}-player-container-${playerId}-operating`);
  if (players.length !== 1) throw new Error('必须有唯一的当前行动玩家');
  const timers = playerCountdownNodes(players, game);
  if (timers.length !== 1) throw new Error('当前行动玩家必须有完整倒计时');
  const values = [...new Set(flattenNodes(timers[0]).filter(node =>
    /^\d+$/.test(node.text || '')).map(node => Number(node.text)))];
  if (values.length !== 1 || values[0] <= 0) throw new Error('当前倒计时必须显示唯一的正数秒数');
  return { node: timers[0], seconds: values[0] };
}
