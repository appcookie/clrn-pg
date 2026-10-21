import { expect } from '@playwright/test';
import type { NativeDevice, NativeNode } from './native-device';
import { stableNativeObservation } from './native-stability';

type ObservationOptions = { timeout?: number; interval?: number };

/** Read the one visible native close control without a full populated review
 * tree. Complete both driver observations before deciding whether it is ready.
 */
export async function waitReviewCloseButton(device: Pick<NativeDevice, 'transientMarker'>,
  visible = true, options: ObservationOptions = {}) {
  return stableNativeObservation(() => device.transientMarker('review-board-close-button'), (previous, current) => {
    if (!visible) {
      expect(previous, '牌谱关闭按钮必须消失').toBeNull();
      expect(current, '牌谱关闭按钮必须持续消失').toBeNull();
      return;
    }
    expect(previous, '牌谱关闭按钮必须可见').not.toBeNull();
    expect(current, '牌谱关闭按钮必须持续可见').not.toBeNull();
    expect(current!.bounds, '牌谱关闭按钮位置必须稳定').toEqual(previous!.bounds);
  }, { timeout: 45_000, interval: 250, ...options });
}

/** These screenshots use one fixture game. Verify complete native content and
 * page state in completed observations, without focusing or masking the input.
 */
export async function waitReviewContent(device: Pick<NativeDevice, 'nodes'>,
  mode?: 'settlement' | 'record', options: ObservationOptions = {}): Promise<NativeNode[]> {
  const assertContent = (nodes: NativeNode[]) => {
    const visible = nodes.filter(node => node.visible !== false);
    expect(visible.filter(node => node.res === 'PlayerBenefitView_Settlement')
      .map(node => node.text).sort(), '牌谱必须包含完整的两名玩家结算').toEqual(['-180', '180']);
    if (!mode) return;
    expect(visible.some(node => node.res === 'TexasPlayerActionIcon_container'),
      '牌谱当前页签必须符合截图状态').toBe(mode === 'record');
    const inputs = visible.filter(node => node.res === 'review-board-page-input');
    expect(inputs.length, '牌谱必须包含实际页码输入框').toBeGreaterThan(0);
    // Fabric may expose both the named wrapper and its TextField at the same
    // bounds. They describe one physical input, not two different page fields.
    const geometry = (node: NativeNode) => JSON.stringify([
      node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height,
    ]);
    expect(new Set(inputs.map(geometry)).size, '牌谱必须包含唯一物理页码输入框').toBe(1);
    const input = inputs[0];
    const fields = visible.filter(node => /TextField|TextView/.test(node.clazz)
      && geometry(node) === geometry(input));
    const values = fields.length ? fields : inputs.filter(node => node.text !== undefined);
    expect(values.length, '牌谱必须能读取实际页码').toBeGreaterThan(0);
    for (const value of values) expect(value.text, '单局牌谱必须显示实际页码 1').toBe('1');
    expect(visible.some(node => node.clazz === 'XCUIElementTypeKeyboard'), '牌谱截图时键盘必须收起').toBe(false);
    expect(visible.some(node => node.text === '/1' && node.bounds.x >= input.bounds.x + input.bounds.width
      && node.bounds.y >= input.bounds.y
      && node.bounds.y + node.bounds.height <= input.bounds.y + input.bounds.height),
    '单局牌谱必须显示实际总页数 /1').toBe(true);
  };
  return stableNativeObservation(() => device.nodes(), (previous, current) => {
    assertContent(previous);
    assertContent(current);
  }, { timeout: 45_000, interval: 250, ...options });
}
