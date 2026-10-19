import type { Bounds, NativeNode } from './native-device';

export function intersectBounds(left: Bounds, right: Bounds): Bounds {
  const x = Math.max(left.x, right.x), y = Math.max(left.y, right.y);
  return { x, y, width: Math.max(0, Math.min(left.x + left.width, right.x + right.width) - x),
    height: Math.max(0, Math.min(left.y + left.height, right.y + right.height) - y) };
}

/** Resolve the target's real ancestry: sibling lists cannot clip or scroll this control. */
export function nativeViewport(nodes: NativeNode[], target: NativeNode, screen: Bounds) {
  const children = new Set(nodes.flatMap(node => node.children));
  const roots = nodes.filter(node => !children.has(node));
  const matches = (node: NativeNode) => node === target || (node.clazz === target.clazz
    && (target.res ? node.res === target.res : node.text === target.text
      && JSON.stringify(node.bounds) === JSON.stringify(target.bounds)));
  function find(node: NativeNode, parents: NativeNode[]): NativeNode[] | undefined {
    if (matches(node)) return [...parents, node];
    for (const child of node.children) { const result = find(child, [...parents, node]); if (result) return result; }
  }
  let chain: NativeNode[] | undefined;
  for (const root of roots) { chain = find(root, []); if (chain) break; }
  if (!chain) throw new Error('目标控件已离开当前原生布局，不能使用旧坐标点击。');
  const node = chain.at(-1)!;
  let viewport = screen;
  const scrollables: { node: NativeNode; viewport: Bounds }[] = [];
  for (const ancestor of chain.slice(0, -1)) {
    if (ancestor.visible === false) viewport = { ...viewport, width: 0, height: 0 };
    if (/ScrollView|CollectionView|Table/.test(ancestor.clazz)) {
      viewport = intersectBounds(viewport, ancestor.bounds);
      scrollables.push({ node: ancestor, viewport });
    }
  }
  return { node, viewport, scrollables, visibleBounds: intersectBounds(viewport, node.bounds) };
}

export function fullyInside(bounds: Bounds, viewport: Bounds) {
  return viewport.width > 0 && viewport.height > 0 && bounds.x >= viewport.x && bounds.y >= viewport.y
    && bounds.x + bounds.width <= viewport.x + viewport.width
    && bounds.y + bounds.height <= viewport.y + viewport.height;
}
