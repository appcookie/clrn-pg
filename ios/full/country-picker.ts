import type { NativeDevice, NativeNode } from './native-device';
import { intersectBounds, nativeViewport, pointInside } from './native-viewport';

/** 国家列表是整页容器；就绪取决于真实可操作列表行，不要求整页容器可滚动到中心。 */
export async function waitForCountryPicker(device: Pick<NativeDevice, 'wait' | 'nodes' | 'screenSize'>) {
  const itemId = /^country-code-list-item-\d+$/;
  // Real iOS CI exposes the list and back control; the outer Web screen ID is hidden.
  await device.wait({ res: 'country-code-list' }, { timeout: 10_000 });
  await device.wait({ res: 'back-button', enabled: true }, { timeout: 10_000 });
  await device.wait({ res: itemId, enabled: true }, { timeout: 10_000 });
  const nodes = await device.nodes();
  const list = nodes.find(node => node.res === 'country-code-list' && node.visible !== false);
  const back = nodes.find(node => node.res === 'back-button' && node.visible !== false && node.enabled
    && node.bounds.width > 0 && node.bounds.height > 0);
  if (!list || !back) throw new Error('国家区号选择页的真实列表及返回按钮未显示');
  if (nodes.some(node => node.clazz === 'XCUIElementTypeAlert')) throw new Error('国家区号选择页被原生错误弹窗遮挡');
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
}
