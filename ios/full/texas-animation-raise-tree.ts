import type { NativeNode as GameNode } from './game-controls';
import type { ScreenshotBounds } from './screenshot';
import { contains, sameBounds, type Screen } from './texas-animation-geometry';
import { texasRaiseControls } from './texas-raise-region';

export type RaiseNode = Omit<GameNode, 'children'> & { clazz?: string; children?: RaiseNode[] };

export function descendants(nodes: RaiseNode[]): RaiseNode[] {
  const seen = new Set<RaiseNode>();
  const visit = (node: RaiseNode) => {
    if (seen.has(node)) return;
    seen.add(node); node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  // A flattened tree can repeat a semantic node already present as a child.
  return [...new Map([...seen].map(node => [JSON.stringify([node.res, node.clazz, node.bounds, node.text]), node])).values()];
}

export function visibleRaiseRoot(node: RaiseNode) {
  return node.res === 'raise-bet-popup' && node.visible !== false;
}
export function rulerWithin(node: RaiseNode, bounds: ScreenshotBounds) {
  return node.clazz === 'XCUIElementTypeScrollView' && contains(bounds, node.bounds);
}

export function thumbImage(nodes: RaiseNode[], screen: Screen) {
  const { thumb, value } = texasRaiseControls(nodes);
  const images = descendants([thumb]).filter(node => node.clazz === 'XCUIElementTypeImage'
    && contains(node.bounds, value.bounds));
  if (images.length !== 1) throw new Error('加注数字必须位于唯一实际滑块背景图片内');
  const imageNode = images[0];
  if (imageNode.visible === false) validateHiddenImage(nodes, thumb, value, imageNode, screen);
  validateImageGeometry(imageNode.bounds, value, screen);
  return { image: imageNode.bounds, value };
}
function requireHiddenImage(valid: boolean) {
  if (!valid) throw new Error('隐藏AX滑块图片必须匹配唯一可见全屏弹窗内的实际ImageBackground子树');
}
function hiddenEnabled(node: RaiseNode) {
  return node.visible === false && node.enabled === true;
}
function anonymousLeaf(node: RaiseNode) {
  return !node.children?.length && !node.res;
}
function supportedImage(node: RaiseNode) {
  // 39614634243 exposes this exact resource name; anonymous images remain valid.
  const expected = 'assets/src/texas_holdem_react_native/main/component/raise-bet/resource/image/img_value@3x.png';
  return !node.res || node.res === expected;
}
function validateHiddenRoot(nodes: RaiseNode[], screen: Screen) {
  const roots = descendants(nodes).filter(visibleRaiseRoot);
  requireHiddenImage(roots.length === 1);
  requireHiddenImage(roots[0].enabled === true && sameBounds(roots[0].bounds, { x: 0, y: 0, ...screen }));
}
function validateWrapper(thumb: RaiseNode, value: RaiseNode, image: RaiseNode) {
  const wrapper = imageWrapper(thumb, image);
  requireHiddenImage(Boolean(wrapper));
  const actual = wrapper!;
  const structure = [actual.clazz === 'XCUIElementTypeOther', hiddenEnabled(actual), !actual.res,
    sameBounds(actual.bounds, image.bounds), actual.children?.length === 1];
  requireHiddenImage(structure.every(Boolean));
  validateThumbChildren(thumb, value);
}
function validateHiddenGeometry(thumb: ScreenshotBounds, image: ScreenshotBounds, scale: number) {
  const horizontal = [thumb.x >= image.x, thumb.x + thumb.width <= image.x + image.width];
  const vertical = [Math.abs(image.y - thumb.y) <= 2, image.height >= thumb.height,
    image.height - thumb.height <= 12 * scale];
  requireHiddenImage(horizontal.every(Boolean) && vertical.every(Boolean));
}
function validateHiddenImage(nodes: RaiseNode[], thumb: RaiseNode, value: RaiseNode, image: RaiseNode, screen: Screen) {
  // run39542210460: Fabric hides a still drawn ImageBackground after 40→618.
  // Accept only that mounted subtree inside one enabled full-screen popup.
  validateHiddenRoot(nodes, screen);
  requireHiddenImage([hiddenEnabled(thumb), hiddenEnabled(value), image.enabled === true,
    supportedImage(image), !image.children?.length].every(Boolean));
  validateWrapper(thumb, value, image);
  validateHiddenGeometry(thumb.bounds, image.bounds, screen.width / 1178);
}
function validateImageGeometry(image: ScreenshotBounds, value: RaiseNode, screen: Screen) {
  const s = screen.width / 1178;
  const size = [image.width >= 180 * s, image.width <= 260 * s,
    image.height >= 80 * s, image.height <= 115 * s];
  const text = [value.bounds.height <= image.height * 0.7, /^\d{1,4}$/.test(value.text || '')].every(Boolean);
  if (![contains({ x: 0, y: 0, ...screen }, image), size.every(Boolean), text].every(Boolean))
    throw new Error('加注数字和滑块背景必须保持已确认的单行原生几何');
}

function scaleText(node: RaiseNode) {
  return node.clazz === 'XCUIElementTypeStaticText' && /^\d+$/.test(node.text || '');
}
function railSegment(node: RaiseNode, ruler: RaiseNode, scale: number) {
  const size = [node.bounds.width <= 30 * scale, node.bounds.height <= ruler.bounds.height / 4];
  return [node.clazz === 'XCUIElementTypeOther', anonymousLeaf(node), size.every(Boolean)].every(Boolean);
}
function rulerLeaf(node: RaiseNode, ruler: RaiseNode, scale: number) {
  return contains(ruler.bounds, node.bounds) && (scaleText(node) || railSegment(node, ruler, scale));
}
export function rulerLeaves(ruler: RaiseNode, scale: number) {
  const leaves = descendants([ruler]).filter(node => rulerLeaf(node, ruler, scale));
  if (!leaves.some(node => node.clazz === 'XCUIElementTypeStaticText')
    || !leaves.some(node => node.clazz === 'XCUIElementTypeOther')) throw new Error('原生刻度文字和轨道必须同时存在');
  return leaves;
}

function imageWrapper(thumb: RaiseNode, image: RaiseNode) {
  return thumb.children?.find(node => node.children?.includes(image));
}
function validateThumbChildren(thumb: RaiseNode, value: RaiseNode) {
  requireHiddenImage(thumb.children?.length === 2 && thumb.children.includes(value));
}
