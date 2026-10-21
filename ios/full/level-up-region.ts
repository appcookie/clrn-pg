import type { NativeNode } from './game-controls';
import type { ScreenshotBounds } from './screenshot';

export type LevelUpRegions = { panel: ScreenshotBounds; title: ScreenshotBounds; timer: ScreenshotBounds };

/** LevelUpModal keeps its content mounted at translateY=-window.height until
 * show(). Read those actual native bounds and undo that documented translation.
 * Do not query the slow accessibility service during the five-second prompt.
 */
export function nativeLevelUpRegions(nodes: NativeNode[], screen: { width: number; height: number }): LevelUpRegions {
  const seen = new Set<NativeNode>();
  const visit = (node: NativeNode) => {
    if (seen.has(node)) return;
    seen.add(node); node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  const all = [...seen];
  const markers = ['level-up-title', 'countdown_timer_text', 'level-up-close-button'];
  const controls = markers.map(res => {
    const found = all.filter(node => node.res === res);
    if (found.length !== 1) throw new Error(`升级提示必须有唯一的当前原生控件：${res}`);
    return found[0];
  });
  const contains = (node: NativeNode, target: NativeNode): boolean =>
    node === target || Boolean(node.children?.some(child => contains(child, target)));
  const panels = all.filter(node => node.bounds.x === 0 && node.bounds.y === -screen.height
    && node.bounds.width === screen.width && node.bounds.height > 0 && node.bounds.height < screen.height / 3
    && controls.every(control => contains(node, control)))
    .sort((a, b) => a.bounds.height - b.bounds.height);
  if (!panels.length) throw new Error('升级提示必须尚未出现，且原生容器使用一屏高度的隐藏位移');
  const panel = { ...panels[0].bounds, y: 0 };
  const translated = controls.map(node => ({ ...node.bounds, y: node.bounds.y + screen.height }));
  if (translated.some(b => b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0
    || b.x + b.width > panel.width || b.y + b.height > panel.height)) {
    throw new Error('升级提示标题、倒计时和关闭按钮必须完整位于实际面板内');
  }
  return { panel, title: translated[0], timer: translated[1] };
}
