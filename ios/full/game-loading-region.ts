import type { NativeLayoutNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';

/** Use the stable container when XCTest exposes it. Fabric may flatten that
 * layout-only View, so also recover its geometry from the two actual images:
 * pinned LoadingStyle has a 60pt circle and a 30pt spade at the same center,
 * and rotateY leaves the spade's native height unchanged.
 */
export function gameLoadingRegions(nodes: NativeLayoutNode[], screen: { width: number; height: number }) {
  const seen = new Set<NativeLayoutNode>();
  const visit = (node: NativeLayoutNode) => {
    if (seen.has(node)) return;
    seen.add(node); node.children.forEach(visit);
  };
  nodes.forEach(visit);
  const current = [...seen];
  const circles = current.filter(n => /\/icon_loading_circle(?:@\dx)?\.png$/.test(n.res || ''));
  const spades = current.filter(n => /\/icon_loading_spade(?:@\dx)?\.png$/.test(n.res || ''));
  if (circles.length !== 1 || spades.length !== 1) throw new Error('必须同时看到唯一的真实加载圆环和黑桃图片');
  const [circle] = circles, [spade] = spades;
  const s = spade.bounds, c = circle.bounds;
  const diameter = s.height * 2;
  const center = { x: Math.round(s.x + s.width / 2), y: Math.round(s.y + s.height / 2) };
  if (s.height <= 0 || diameter ** 2 >= screen.width * screen.height / 4
    || s.width < 0 || s.width > s.height + 2
    || Math.abs(c.x + c.width / 2 - center.x) > 2
    || Math.abs(c.y + c.height / 2 - center.y) > 2
    || c.width < diameter - 3 || c.height < diameter - 3
    || c.width > Math.ceil(diameter * Math.SQRT2) + 3
    || c.height > Math.ceil(diameter * Math.SQRT2) + 3
    || Math.abs(c.width - c.height) > 3) {
    throw new Error('加载图片必须符合原生同中心圆环和半径黑桃的旋转几何');
  }
  const contains = (parent: NativeLayoutNode, child: NativeLayoutNode): boolean => parent === child || parent.children.some(n => contains(n, child));
  const panel = current.filter(n => n.clazz === 'XCUIElementTypeOther'
    && Math.abs(n.bounds.width - diameter) <= 3 && Math.abs(n.bounds.height - diameter) <= 3
    && Math.abs(n.bounds.x + n.bounds.width / 2 - center.x) <= 2
    && Math.abs(n.bounds.y + n.bounds.height / 2 - center.y) <= 2
    && contains(n, circle) && contains(n, spade))
    .sort((a, b) => a.bounds.width - b.bounds.width)[0];
  const p = panel?.bounds || { x: center.x - diameter / 2, y: center.y - diameter / 2,
    width: diameter, height: diameter };
  // Pinned LoadingStyle uses a 60pt ring and 30pt spade. Keep its complete
  // maximum rotation envelope, with 4px raster padding for both layers.
  const ring: ScreenshotBounds = { x: p.x - 4, y: p.y - 4, width: p.width + 8, height: p.height + 8 };
  const inner: ScreenshotBounds = { x: Math.floor(p.x + p.width / 4) - 4, y: Math.floor(p.y + p.height / 4) - 4,
    width: Math.ceil(p.width / 2) + 8, height: Math.ceil(p.height / 2) + 8 };
  for (const b of [ring, inner]) {
    if (b.x < 0 || b.y < 0 || b.x + b.width > screen.width || b.y + b.height > screen.height) {
      throw new Error('加载图标完整范围必须位于原生截图内');
    }
  }
  return { ring, spade: inner, ringMasks: [{ ...inner, reason: '中心黑桃由独立轨迹检查；圆环检查保留全部外圈像素' }] };
}
