import type { NativeDevice } from './native-device';
import { nativeViewport, pointInside } from './native-viewport';

/** 国家列表是整页容器；就绪取决于真实可操作列表行，不要求整页容器可滚动到中心。 */
export async function waitForCountryPicker(device: Pick<NativeDevice, 'wait' | 'nodes' | 'screenSize'>) {
  const itemId = /^country-code-list-item-\d+$/;
  await device.wait({ res: 'pick-country-code-container' }, { timeout: 10_000 });
  await device.wait({ res: itemId, enabled: true }, { timeout: 10_000 });
  const nodes = await device.nodes();
  if (!nodes.some(node => node.res === 'pick-country-code-container')) throw new Error('国家区号选择页未显示');
  if (nodes.some(node => node.clazz === 'XCUIElementTypeAlert')) throw new Error('国家区号选择页被原生错误弹窗遮挡');
  const screen = { x: 0, y: 0, ...device.screenSize };
  if (!nodes.some(node => {
    if (!itemId.test(node.res || '') || !node.enabled || node.visible === false
      || node.bounds.width <= 0 || node.bounds.height <= 0) return false;
    const { node: current, viewport } = nativeViewport(nodes, node, screen);
    return current.visible !== false && pointInside({ x: current.bounds.x + current.bounds.width / 2,
      y: current.bounds.y + current.bounds.height / 2 }, viewport);
  })) {
    throw new Error('国家区号选择页没有可见且启用的区号选项');
  }
}
