import type { NativeDevice, NativeNode } from './native-device';
import { intersectBounds, nativeViewport, pointInside } from './native-viewport';
import { setTimeout as delay } from 'node:timers/promises';

/** 国家列表是整页容器；就绪取决于真实可操作列表行，不要求整页容器可滚动到中心。 */
export async function waitForCountryPicker(device: Pick<NativeDevice, 'nodes' | 'screenSize'>,
  { timeout = 10_000 }: { timeout?: number } = {}) {
  const itemId = /^country-code-list-item-\d+$/;
  // CI reached all three real markers, then timed out while requesting a fourth
  // AX snapshot of this large list. Check readiness and geometry on one snapshot;
  // only request another while the sheet's required controls are still missing.
  const deadline = Date.now() + timeout;
  let nodes: NativeNode[];
  do {
    nodes = await device.nodes();
    if (nodes.some(node => node.clazz === 'XCUIElementTypeAlert')) throw new Error('国家区号选择页被原生错误弹窗遮挡');
    if (nodes.some(node => node.res === 'alert-message-text')) throw new Error('国家区号选择页显示应用错误提示');
    if (nodes.some(node => node.res === 'country-code-list' && node.visible !== false)
      && nodes.some(node => node.res === 'back-button' && node.enabled && node.visible !== false)
      && nodes.some(node => itemId.test(node.res || '') && node.enabled && node.visible !== false)
      && !nodes.some(node => /^(XCUIElementTypeActivityIndicator|XCUIElementTypeKeyboard)$/.test(node.clazz))) break;
    if (Date.now() >= deadline) break;
    await delay(250);
  } while (true);
  if (nodes.some(node => node.clazz === 'XCUIElementTypeActivityIndicator')) throw new Error('国家区号选择页仍在加载');
  if (nodes.some(node => node.clazz === 'XCUIElementTypeKeyboard')) throw new Error('国家区号选择页仍被键盘遮挡');
  const list = nodes.find(node => node.res === 'country-code-list' && node.visible !== false);
  const back = nodes.find(node => node.res === 'back-button' && node.visible !== false && node.enabled
    && node.bounds.width > 0 && node.bounds.height > 0);
  if (!list || !back) throw new Error('国家区号选择页的真实列表及返回按钮未显示');
  const screen = { x: 0, y: 0, ...device.screenSize };
  const backViewport = nativeViewport(nodes, back, screen);
  if (!pointInside({ x: back.bounds.x + back.bounds.width / 2, y: back.bounds.y + back.bounds.height / 2 }, backViewport.viewport)) {
    throw new Error('国家区号选择页的返回按钮不可操作');
  }
  const descendants = (node: NativeNode): NativeNode[] => [node, ...node.children.flatMap(descendants)];
  const listNodes = new Set(descendants(list));
  const listViewport = nativeViewport(nodes, list, screen).visibleBounds;
  if (!nodes.some(node => {
    if (!listNodes.has(node) || !itemId.test(node.res || '') || !node.enabled || node.visible === false
      || node.bounds.width <= 0 || node.bounds.height <= 0) return false;
    const { node: current, viewport } = nativeViewport(nodes, node, screen);
    return current.visible !== false && pointInside({ x: current.bounds.x + current.bounds.width / 2,
      y: current.bounds.y + current.bounds.height / 2 }, intersectBounds(viewport, listViewport));
  })) {
    throw new Error('国家区号选择页没有可见且启用的区号选项');
  }
  return nodes;
}
