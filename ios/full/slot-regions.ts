import type { Bounds, NativeNode } from './native-device';

export const slotNoEnergyImage = /\/slot-machine\/.*\/img_out_of_spins@3x\.png$/;

/** 点击大厅横幅右下方可见的旋转入口，避开文字和循环滚动的图案。 */
export function slotBannerSpinPoint(bounds: Bounds): { x: number; y: number } {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) throw new Error('老虎机横幅缺少有效的原生边界');
  return { x: Math.round(bounds.x + bounds.width * 0.72),
    y: Math.round(bounds.y + bounds.height * 0.70) };
}

/** The released iOS popup has no slot-no-energy-popup-container identifier.
 * Its content, close control and static left gutter remain measurable natively.
 */
export function slotNoEnergyRegions(nodes: NativeNode[], screen: { width: number; height: number }) {
  const content = [
    nodes.find(node => slotNoEnergyImage.test(node.res || '')),
    nodes.find(node => node.res === 'confirm-button'),
    nodes.find(node => node.text === 'Out of Spins?'),
  ];
  const close = nodes.find(node => node.res === 'close-button');
  if (content.some(node => !node) || !close) throw new Error('能量不足提示缺少原生图片、标题、确认或关闭控件');
  const containers = nodes.filter(node => node.clazz === 'XCUIElementTypeOther'
    && node.bounds.width > 0 && node.bounds.height > 0
    && node.bounds.width * node.bounds.height < screen.width * screen.height
    && content.every(child => {
      const a = node.bounds, b = child!.bounds;
      return a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width
        && a.y + a.height >= b.y + b.height;
    })).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
  if (!containers.length) throw new Error('无法定位能量不足提示的真实原生面板');
  const panel = containers[0].bounds;
  // Use half of the empty left gutter: exclude text/artwork and the random reels
  // behind the entering prompt. The whole prompt is compared separately.
  const border = { x: panel.x, y: panel.y,
    width: Math.floor((Math.min(...content.map(node => node!.bounds.x)) - panel.x) / 2), height: panel.height };
  if (border.width <= 0) throw new Error('能量不足提示没有可独立采样的静态左边框');
  const x = Math.max(0, Math.min(panel.x, close.bounds.x) - 4);
  const y = Math.max(0, Math.min(panel.y, close.bounds.y) - 4);
  const right = Math.min(screen.width, Math.max(panel.x + panel.width, close.bounds.x + close.bounds.width) + 4);
  const bottom = Math.min(screen.height, Math.max(panel.y + panel.height, close.bounds.y + close.bounds.height) + 4);
  return { border, full: { x, y, width: right - x, height: bottom - y } };
}

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
