/** 仅排除牌谱端点无遮挡的实时网络状态，完整保留前景与原片运动。 */
import type { NativeNode } from './native-device';
import type { ScreenshotMask } from './screenshot';
import { foregroundPanels, networkStatusMask, subtractPanel } from './game-masks';

export function reviewEndpointNetworkMasks(nodes: NativeNode[],
  screen: { width: number; height: number }): ScreenshotMask[] {
  const panels = foregroundPanels(nodes, screen);
  const result: ScreenshotMask[] = [];
  const anchors = [...new Map(nodes.filter(node => node.res === 'ping-screen-container'
    && node.visible !== false).map(node => [JSON.stringify([
      node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height,
    ]), node])).values()];
  if (anchors.length > 1) throw new Error('牌谱端点必须只有一个物理网络状态锚点');
  for (const node of anchors) {
    const b = node.bounds;
    if (![b.x, b.y, b.width, b.height].every(Number.isInteger)
      || b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0
      || b.x + b.width !== screen.width || b.y + b.height > screen.height
      || b.width > screen.width / 4 || b.height > screen.height / 5) {
      throw new Error('牌谱端点网络状态必须位于当前原生右侧锚点');
    }
    // 包括前景最外一像素；网络数字的排除不得在牌谱边缘打洞。
    const parts = panels.reduce((remaining, panel) => remaining.flatMap(mask =>
      subtractPanel(mask, panel.bounds)), [networkStatusMask(b)]);
    result.push(...parts);
  }
  return [...new Map(result.map(mask => [JSON.stringify(mask), mask])).values()];
}
