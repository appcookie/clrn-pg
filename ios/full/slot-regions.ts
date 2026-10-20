import type { Bounds, NativeNode } from './native-device';

/** Derive the three reels from their real native image children and clipping window.
 * Offscreen symbols in each long rolling strip cannot expand the visible crop.
 */
export function slotReelRegions(nodes: NativeNode[]): { window: Bounds; reels: Bounds[] } {
  const cache = new Map<NativeNode, NativeNode[]>();
  const symbols = (node: NativeNode): NativeNode[] => {
    if (!cache.has(node)) cache.set(node,
      /\/slot_item_[^/]+\.png$/.test(node.res || '') ? [node] : node.children.flatMap(symbols));
    return cache.get(node)!;
  };
  const containers = new Set<NativeNode>();
  const visit = (node: NativeNode) => {
    if (containers.has(node)) return;
    containers.add(node); node.children.forEach(visit);
  };
  nodes.forEach(visit);
  const candidates = [...containers].flatMap(node => {
    const box = node.bounds;
    if (box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0) return [];
    const columns = new Map<string, Map<number, NativeNode>>();
    for (const symbol of symbols(node)) {
      const b = symbol.bounds, x = b.x + b.width / 2, y = b.y + b.height / 2;
      if (b.width <= 0 || b.height <= 0 || x < box.x || x >= box.x + box.width
        || y < box.y || y >= box.y + box.height) continue;
      const key = `${b.x}:${b.width}`;
      if (!columns.has(key)) columns.set(key, new Map());
      columns.get(key)!.set(b.y, symbol);
    }
    if (columns.size !== 3 || [...columns.values()].some(rows => rows.size < 3)) return [];
    const reels = [...columns.values()].map(rows => {
      const b = rows.values().next().value!.bounds;
      return { x: b.x, y: box.y, width: b.width, height: box.height };
    }).sort((a, b) => a.x - b.x);
    return [{ window: box, reels }];
  }).sort((a, b) => a.window.width * a.window.height - b.window.width * b.window.height);
  if (!candidates.length) throw new Error('无法从真实 iOS 控件树定位三个各含三行图案的滚轮。');
  return candidates[0];
}
