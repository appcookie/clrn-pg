import type { NativeNode } from './game-controls';

/** The history also has a "Settlement" section heading. Only the paired tabs
 * directly above the native slider are interactive navigation targets.
 */
export function nativeReviewTab(nodes: NativeNode[], mode: 'settlement' | 'record'): NativeNode {
  const slider = nodes.find(node => node.visible !== false && node.res === 'review-board-slider');
  if (!slider) throw new Error('牌谱底部滑块必须可见');
  const patterns = { settlement: /^(Settlement|结算|結算)$/, record: /^(Record|Details?|牌局详情|牌局詳情)$/ };
  const tabs = Object.fromEntries(Object.entries(patterns).map(([key, text]) => [key,
    nodes.filter(node => node.visible !== false && text.test(node.text || '')
      && node.bounds.width > slider.bounds.width / 2 && node.bounds.height > 0
      && Math.abs(node.bounds.y + node.bounds.height - slider.bounds.y) <= 3)]));
  if (tabs.settlement.length !== 1 || tabs.record.length !== 1) throw new Error('必须定位唯一的结算/牌局记录标签对');
  const left = tabs.settlement[0].bounds, right = tabs.record[0].bounds;
  if (left.y !== right.y || left.height !== right.height
    || Math.abs(left.x + left.width - right.x) > 4) throw new Error('牌谱底部标签必须并排对齐');
  return tabs[mode][0];
}
