import type { NativeNode as GameNode } from './game-controls';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { subtractPanel } from './game-masks';
import { texasRaiseControls } from './texas-raise-region';

type NativeNode = Omit<GameNode, 'children'> & { clazz?: string; children?: NativeNode[] };

const contains = (a: ScreenshotBounds, b: ScreenshotBounds) => b.width > 0 && b.height > 0
  && b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
function descendants(nodes: NativeNode[]): NativeNode[] {
  const seen = new Set<NativeNode>();
  const visit = (node: NativeNode) => {
    if (seen.has(node)) return;
    seen.add(node); node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  // A flattened tree can repeat a semantic node already present as a child.
  return [...new Map([...seen].map(node => [JSON.stringify([node.res, node.clazz, node.bounds, node.text]), node])).values()];
}
function thumbImage(nodes: NativeNode[], screen: { width: number; height: number }) {
  const { thumb, value } = texasRaiseControls(nodes);
  const images = descendants([thumb]).filter(node => node.clazz === 'XCUIElementTypeImage'
    && contains(node.bounds, value.bounds));
  if (images.length !== 1) throw new Error('加注数字必须位于唯一实际滑块背景图片内');
  const imageNode = images[0];
  if (imageNode.visible === false) {
    // run39542210460: after the real 40→618 drag, Fabric reports the
    // ImageBackground wrapper and its image hidden while both remain drawn.
    // Accept only that exact mounted thumb subtree, never an arbitrary hidden
    // image or a node elsewhere in the full-screen popup. Keep AX fields intact.
    const roots = descendants(nodes).filter(node => node.res === 'raise-bet-popup' && node.visible !== false);
    const wrapper: NativeNode | undefined = thumb.children?.find(node => node.children?.includes(imageNode));
    const sameBounds = (a: ScreenshotBounds, b: ScreenshotBounds) => a.x === b.x && a.y === b.y
      && a.width === b.width && a.height === b.height;
    // 39614634243 的同一图片由 AX 暴露了资源路径；匿名或精确匹配
    // 该资源均保留全部结构、可见性和几何校验，其他具名图片仍拒绝。
    const expectedImage = 'assets/src/texas_holdem_react_native/main/component/raise-bet/resource/image/img_value@3x.png';
    const s = screen.width / 1178;
    if (roots.length !== 1 || roots[0].enabled !== true || !sameBounds(roots[0].bounds, { x: 0, y: 0, ...screen })
      || thumb.visible !== false || value.visible !== false || thumb.enabled !== true || value.enabled !== true
      || imageNode.enabled !== true || (imageNode.res && imageNode.res !== expectedImage)
      || imageNode.children?.length || !wrapper || wrapper.clazz !== 'XCUIElementTypeOther'
      || wrapper.visible !== false || wrapper.enabled !== true || wrapper.res
      || !sameBounds(wrapper.bounds, imageNode.bounds) || wrapper.children?.length !== 1
      || thumb.children?.length !== 2 || !thumb.children.includes(value)
      || Math.abs(imageNode.bounds.y - thumb.bounds.y) > 2
      || thumb.bounds.x < imageNode.bounds.x || thumb.bounds.x + thumb.bounds.width > imageNode.bounds.x + imageNode.bounds.width
      || imageNode.bounds.height < thumb.bounds.height || imageNode.bounds.height - thumb.bounds.height > 12 * s) {
      throw new Error('隐藏AX滑块图片必须匹配唯一可见全屏弹窗内的实际ImageBackground子树');
    }
  }
  const image = images[0].bounds, s = screen.width / 1178;
  if (!contains({ x: 0, y: 0, ...screen }, image) || image.width < 180 * s || image.width > 260 * s
    || image.height < 80 * s || image.height > 115 * s
    || value.bounds.height > image.height * 0.7 || !/^\d{1,4}$/.test(value.text || '')) {
    throw new Error('加注数字和滑块背景必须保持已确认的单行原生几何');
  }
  return { image, value };
}

/** Only the room clock is independent of the raise gesture. Hidden UIKit
 * accessibility does not make these background pixels disappear. Keep every
 * actual foreground rail segment, scale label, thumb and button unmasked.
 */
export function texasRaiseClockMasks(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotMask[] {
  const all = descendants(nodes), s = screen.width / 1178;
  const clocks = all.filter(node => node.res === 'countdown-text');
  const icons = all.filter(node => node.clazz === 'XCUIElementTypeImage'
    && node.res?.endsWith('/room-profile/resource/image/icon_room_countdown_green@3x.png'));
  if (clocks.length !== 1 || icons.length !== 1) throw new Error('加注背景必须有唯一原生房间倒计时及其图标');
  const clock = clocks[0], b = clock.bounds, icon = icons[0].bounds;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(clock.text || '') || !contains({ x: 0, y: 0, ...screen }, b)
    || !contains({ x: 0, y: 0, ...screen }, icon) || b.height > 60 * s || b.width > 240 * s
    || icon.width > 55 * s || icon.height > 55 * s
    || b.x < icon.x + icon.width || b.x - icon.x - icon.width > 12 * s
    || Math.abs(b.y + b.height / 2 - icon.y - icon.height / 2) > 6 * s) {
    throw new Error('房间倒计时必须是原生图标右侧的完整单行文字');
  }
  let masks: ScreenshotMask[] = [{ ...b, reason: '原生房间倒计时独立跳秒；加注前景仍完整比较' }];
  const roots = all.filter(node => node.res === 'raise-bet-popup' && node.visible !== false);
  if (!roots.length) return masks;
  if (roots.length !== 1) throw new Error('加注遮罩必须只对应一个实际面板');
  const controls = texasRaiseControls(nodes);
  const rulers = descendants([roots[0]]).filter(node => node.clazz === 'XCUIElementTypeScrollView'
    && contains(controls.slider.bounds, node.bounds));
  if (rulers.length !== 1) throw new Error('必须找到滑块内唯一原生刻度尺');
  const ruler = rulers[0];
  const leaves = descendants([ruler]).filter(node => contains(ruler.bounds, node.bounds)
    && ((node.clazz === 'XCUIElementTypeStaticText' && /^\d+$/.test(node.text || ''))
      || (node.clazz === 'XCUIElementTypeOther' && !node.children?.length && !node.res
        && node.bounds.width <= 30 * s && node.bounds.height <= ruler.bounds.height / 4)));
  if (!leaves.some(node => node.clazz === 'XCUIElementTypeStaticText')
    || !leaves.some(node => node.clazz === 'XCUIElementTypeOther')) throw new Error('原生刻度文字和轨道必须同时存在');
  const protectedBounds = [...leaves.map(node => node.bounds), thumbImage(nodes, screen).image,
    controls.cancel.bounds, controls.confirm.bounds];
  for (const bounds of protectedBounds) masks = masks.flatMap(mask => subtractPanel(mask, {
    x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2,
  }));
  return masks;
}

/** The native gold image supplies a fixed text slot for 1–4 digit values.
 * Only endpoint comparison uses it; the image border, pointer, thumb position
 * and all raw video/PNG pixels remain available to the movement gate.
 */
export function texasRaiseValueMask(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotMask[] {
  const { image, value } = thumbImage(nodes, screen);
  const { slider, thumb, cancel, confirm } = texasRaiseControls(nodes);
  const rulers = descendants(nodes.filter(node => node.res === 'raise-bet-popup'))
    .filter(node => node.clazz === 'XCUIElementTypeScrollView' && contains(slider.bounds, node.bounds));
  const x = Math.ceil(image.x + image.width / 6), right = Math.floor(image.x + image.width * 5 / 6);
  const y = Math.ceil(image.y + image.height * 0.18), bottom = Math.floor(image.y + image.height * 0.82);
  const bounds = { x, y, width: right - x, height: bottom - y };
  if (!contains(bounds, value.bounds) || rulers.length !== 1
    || bounds.x <= rulers[0].bounds.x + rulers[0].bounds.width
    || Math.abs(image.y - thumb.bounds.y) > 2
    || [cancel, confirm].some(node => subtractPanel({ ...bounds, reason: '' }, node.bounds)
      .reduce((area, part) => area + part.width * part.height, 0) !== bounds.width * bounds.height)) {
    throw new Error('加注数字槽必须覆盖完整文字且不遮刻度、轨道或按钮');
  }
  return [{ ...bounds, reason: '实际金色滑块内部固定数字槽；数值另断言，外框和滑块位置保持比较' }];
}
