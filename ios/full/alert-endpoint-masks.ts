import type { NativeNode } from './game-controls';
import type { ScreenshotMask } from './screenshot';

/** Only the unobstructed endpoint calls this. A clock beneath the alert must
 * never punch a hole through the alert background or its animation frames.
 */
export function alertEndpointClockMasks(nodes: NativeNode[]): ScreenshotMask[] {
  if (nodes.some(node => node.visible !== false && node.res === 'common-alert-message')) return [];
  return nodes.filter(node => node.visible !== false && node.res === 'countdown-text'
    && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(node.text || '')).map(node => ({
    ...node.bounds, x: node.bounds.x - 2, y: node.bounds.y - 2,
    width: node.bounds.width + 4, height: node.bounds.height + 4,
    reason: '错误弹窗无遮挡端点的独立牌局时钟；弹窗与录像帧仍完整比较',
  }));
}
