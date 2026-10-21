import type { NativeNode } from './game-controls';
import type { ScreenshotBounds } from './screenshot';

/** Fabric marks the slider descendants hidden although the current popup and
 * its confirm/cancel buttons are visible. Scope these controls to that popup;
 * its root is the full-screen dimmer, not the bounds of the animated content.
 */
export function texasRaiseControls(nodes: NativeNode[]) {
  const root = nodes.find(node => node.res === 'raise-bet-popup' && node.visible !== false);
  if (!root) throw new Error('加注弹窗必须可见');
  const seen = new Set<NativeNode>();
  const visit = (node: NativeNode): NativeNode[] => {
    if (seen.has(node)) return [];
    seen.add(node);
    return [node, ...(node.children || []).flatMap(visit)];
  };
  const all = visit(root);
  const control = (id: string) => {
    const matches = all.filter(node => node.res === id);
    if (matches.length !== 1) throw new Error(`加注面板必须有唯一控件 ${id}`);
    const node = matches[0], b = node.bounds, a = root.bounds;
    if (node.enabled === false || b.width <= 0 || b.height <= 0 || b.x < a.x || b.y < a.y
      || b.x + b.width > a.x + a.width || b.y + b.height > a.y + a.height) throw new Error(`加注控件不可用 ${id}`);
    return node;
  };
  const cancel = control('raise-bet-cancel-button'), confirm = control('raise-bet-confirm-button');
  if (cancel.visible === false || confirm.visible === false) throw new Error('加注确认和取消按钮必须可见');
  return { slider: control('raise-bet-slider'), thumb: control('sliderThumb'),
    value: control('raise-bet-display-text'), cancel, confirm };
}

export function texasRaiseRegion(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const controls = Object.values(texasRaiseControls(nodes));
  const x = Math.max(0, Math.min(...controls.map(n => n.bounds.x)) - 4);
  const y = Math.max(0, Math.min(...controls.map(n => n.bounds.y)) - 4);
  const right = Math.min(screen.width, Math.max(...controls.map(n => n.bounds.x + n.bounds.width)) + 4);
  const bottom = Math.min(screen.height, Math.max(...controls.map(n => n.bounds.y + n.bounds.height)) + 4);
  return { x, y, width: right - x, height: bottom - y };
}
