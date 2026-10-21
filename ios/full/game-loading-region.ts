import type { NativeLayoutNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';

/** The ring and rotating spade share a stable square native container. Transformed
 * image bounds change during rotation and cannot define the capture rectangle.
 */
export function gameLoadingRegions(nodes: NativeLayoutNode[], screen: { width: number; height: number }) {
  const seen = new Set<NativeLayoutNode>();
  const visit = (node: NativeLayoutNode) => {
    if (seen.has(node)) return;
    seen.add(node); node.children.forEach(visit);
  };
  nodes.forEach(visit);
  const current = [...seen];
  const circle = current.find(n => /\/icon_loading_circle(?:@\dx)?\.png$/.test(n.res || ''));
  const spade = current.find(n => /\/icon_loading_spade(?:@\dx)?\.png$/.test(n.res || ''));
  if (!circle || !spade) throw new Error('必须同时看到真实加载圆环和黑桃图片');
  const contains = (parent: NativeLayoutNode, child: NativeLayoutNode): boolean => parent === child || parent.children.some(n => contains(n, child));
  const panel = current.filter(n => n.clazz === 'XCUIElementTypeOther'
    && n.bounds.width > 0 && Math.abs(n.bounds.width - n.bounds.height) <= 1
    && n.bounds.width * n.bounds.height < screen.width * screen.height / 4
    && contains(n, circle) && contains(n, spade))
    .sort((a, b) => a.bounds.width - b.bounds.width)[0];
  if (!panel) throw new Error('缺少容纳两层加载图片的稳定原生容器');
  const p = panel.bounds;
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
