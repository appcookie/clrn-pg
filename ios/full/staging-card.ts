import type { Bounds, NativeNode } from './native-device';

/** The staging-dialog identifier names the full-screen modal, not its opaque card. */
export function stagingCardBounds(nodes: NativeNode[], screen: { width: number; height: number }): Bounds {
  const flags = new WeakMap<NativeNode, number>();
  const candidates: Bounds[] = [];
  function visit(node: NativeNode): number {
    const cached = flags.get(node);
    if (cached !== undefined) return cached;
    let present = node.res === 'staging-dialog-title' ? 1 : node.res === 'staging-dialog-content' ? 2
      : node.res === 'confirm-button' ? 4 : 0;
    for (const child of node.children) present |= visit(child);
    flags.set(node, present);
    const { x, y, width, height } = node.bounds;
    // The actual iOS card is the outermost inset ancestor containing title, body and
    // action. Its inner paper/scroll viewport is smaller and clips the action footer.
    if (present === 7 && node.visible !== false && node.clazz === 'XCUIElementTypeOther'
      && x > 0 && y > 0 && width > 0 && height > 0 && x + width < screen.width && y + height < screen.height) {
      candidates.push(node.bounds);
    }
    return present;
  }
  for (const node of nodes) visit(node);
  const bounds = candidates.sort((left, right) => right.width * right.height - left.width * left.height)[0];
  if (!bounds) throw new Error('未找到同时包含标题、内容及确认按钮的屏内 Staging 卡片，不能用全屏遮罩代替。');
  return { ...bounds };
}
