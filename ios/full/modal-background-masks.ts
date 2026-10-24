import type { NativeNode } from './game-controls';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { foregroundPanels, networkStatusMask, visibleMasks } from './game-masks';

/** XCTest hides background accessibility while a modal is open, although
 * uncovered timer/ping pixels still render. Recover only those two dynamic
 * elements for screenshot comparison, never for interaction or readiness.
 */
export function modalBackgroundMasks(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotMask[] {
  const panels = foregroundPanels(nodes, screen);
  if (!panels.length) return [];
  const all = new Set<NativeNode>();
  const visit = (node: NativeNode) => {
    if (all.has(node)) return;
    all.add(node);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  const onScreen = (b: ScreenshotBounds) => b.width > 0 && b.height > 0
    && b.x >= 0 && b.y >= 0 && b.x + b.width <= screen.width && b.y + b.height <= screen.height;
  const result: ScreenshotMask[] = [];
  for (const player of all) {
    const game = /^(texas-holdem|zhajinhua)-player-container-.+-operating$/.exec(player.res || '')?.[1];
    if (!game || player.visible !== false || !onScreen(player.bounds)) continue;
    const timers = new Set<NativeNode>();
    const find = (node: NativeNode) => {
      if (node.res === `${game}-active-countdown`) timers.add(node);
      node.children?.forEach(find);
    };
    find(player);
    for (const timer of timers) {
      const b = timer.bounds, p = player.bounds, border = game === 'zhajinhua' ? 4 : 0;
      if (!onScreen(b) || b.x < p.x - border || b.y < p.y - border
        || b.x + b.width > p.x + p.width + border || b.y + b.height > p.y + p.height + border) {
        throw new Error('弹窗背景倒计时必须完整位于当前行动玩家内');
      }
      result.push(...visibleMasks({ x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4,
        reason: '弹窗外仍绘制的当前原生倒计时；前景面板保持比较' }, timer, panels));
    }
  }
  for (const node of all) {
    if (node.res !== 'ping-screen-container' || node.visible !== false) continue;
    const b = node.bounds;
    if (!onScreen(b) || b.x + b.width !== screen.width || b.height > screen.height / 5) {
      throw new Error('弹窗背景网络状态必须位于原生右侧锚点');
    }
    result.push(...visibleMasks(networkStatusMask(b), node, panels));
  }
  // Flattened accessibility lists can repeat the same object/geometry.
  return [...new Map(result.map(mask => [JSON.stringify(mask), mask])).values()];
}
