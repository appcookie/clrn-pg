import { flattenNodes, type NativeNode } from './game-controls';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { playerCountdownNodes } from './game-countdown';
import { setTimeout as delay } from 'node:timers/promises';

export const zhajinhuaOperationMarkers = [
  'zhajinhua-shortcut-raise-first', 'zhajinhua-shortcut-raise-second',
  'zhajinhua-shortcut-raise-third', 'zhajinhua-shortcut-raise-fourth',
  'zhajinhua-operation-button-battle', 'zhajinhua-operation-button-fold',
  'zhajinhua-operation-button-call', 'zhajinhua-operation-accurate-bet-button',
  'zhajinhua-delay-operation-button',
];

export function visibleZhajinhuaOperationControls(nodes: NativeNode[]): NativeNode[] {
  return nodes.filter(node => node.visible !== false && zhajinhuaOperationMarkers.includes(node.res || '')
    && node.bounds.width > 0 && node.bounds.height > 0);
}

function mountedControls(nodes: NativeNode[]): NativeNode[] {
  const parents = nodes.filter(node => node.res === 'zhajinhua-cancel-challenge-choosing' && node.visible !== false);
  if (parents.length > 1) throw new Error('操作区必须属于唯一取消选择原生容器');
  const scoped = [...new Set([...nodes, ...parents.flatMap(flattenNodes)])];
  return scoped.filter(node => zhajinhuaOperationMarkers.includes(node.res || '')
    && node.bounds.width > 0 && node.bounds.height > 0);
}

/** zoomInDown remounts only after all controls have actually disappeared. */
export function zhajinhuaOperationControls(nodes: NativeNode[], screen?: { width: number; height: number }): NativeNode[] {
  const visible = visibleZhajinhuaOperationControls(nodes);
  // Pinned MainScreen wraps the table in TouchableWithoutFeedback. After
  // Cancel its disabled=true makes XCTest report its still-rendered controls
  // visible=false. Read only this exact, visible, disabled parent subtree;
  // callers must also prove all nine controls' raw endpoint pixels and motion.
  const parent = nodes.find(node => node.res === 'zhajinhua-cancel-challenge-choosing'
    && node.visible === true && node.enabled === false && node.bounds.x === 0 && node.bounds.y === 0
    && screen && node.bounds.width === screen.width && node.bounds.height === screen.height);
  mountedControls(nodes); // Reject ambiguous visible parent containers.
  const mounted = parent ? flattenNodes(parent).filter(node => zhajinhuaOperationMarkers.includes(node.res || '')) : [];
  if (parent && flattenNodes(parent).some(node => node.res === 'challenge_player_selector'))
    throw new Error('取消选择后不得残留挑战目标子树');
  const controls = visible.length === zhajinhuaOperationMarkers.length ? visible : parent
    ? mounted.filter(node => node.enabled === true && node.bounds.x >= parent.bounds.x
      && node.bounds.y >= parent.bounds.y && node.bounds.x + node.bounds.width <= parent.bounds.width
      && node.bounds.y + node.bounds.height <= parent.bounds.height) : visible;
  return zhajinhuaOperationMarkers.map(marker => {
    const found = controls.filter(node => node.res === marker);
    if (found.length !== 1) throw new Error(`操作按钮终点必须有唯一可见或取消后可验证的原生控件：${marker}`);
    return found[0];
  });
}

/** Validate the entire prepared state from one completed native observation. */
export function zhajinhuaChallengeCancel(nodes: NativeNode[]): NativeNode {
  if (mountedControls(nodes).length) throw new Error('选择对手时全部9个操作控件必须消失');
  const visible = nodes.filter(node => node.visible !== false && node.bounds.width > 0 && node.bounds.height > 0);
  if (visible.filter(node => node.res === 'challenge_player_selector').length !== 4)
    throw new Error('选择对手时必须有4个真实挑战目标');
  const cancel = visible.filter(node => node.res === 'zhajinhua-cancel-challenge-choosing' && node.enabled !== false);
  if (cancel.length !== 1) throw new Error('必须有唯一可点击的取消选择区域');
  return cancel[0];
}

/** Driver reads retain their own deadline; only an incomplete observed state
 * is polled. A ready state needs one tree, never three independent queries.
 */
export async function readyZhajinhuaChallengeCancel(read: () => Promise<NativeNode[]>,
  timeout = 30_000, interval = 250): Promise<NativeNode> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const nodes = await read();
    try { return zhajinhuaChallengeCancel(nodes); }
    catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(interval);
    }
  }
}

/** Include the four shortcuts, three main buttons, accurate-bet and delay
 * controls. The former estimate clipped the shortcuts and both lower rows.
 */
export function zhajinhuaOperationRegion(before: NativeNode[], after: NativeNode[],
  screen: { width: number; height: number }): ScreenshotBounds {
  if (mountedControls(before).length)
    throw new Error('操作按钮入场起点必须全部消失，已显示的按钮不能重复恢复冒充入场');
  if (after.some(node => node.visible !== false && node.res === 'challenge_player_selector'))
    throw new Error('取消选择后不得残留挑战目标');
  const bounds = zhajinhuaOperationControls(after, screen).map(node => node.bounds);
  if (bounds.some(b => b.x < 0 || b.y < 0 || b.x + b.width > screen.width || b.y + b.height > screen.height))
    throw new Error('操作按钮必须完整位于原生屏幕内');
  const x = Math.max(0, Math.min(...bounds.map(b => b.x)) - 4);
  const y = Math.max(0, Math.min(...bounds.map(b => b.y)) - 4);
  return { x, y, width: Math.min(screen.width, Math.max(...bounds.map(b => b.x + b.width)) + 4) - x,
    height: Math.min(screen.height, Math.max(...bounds.map(b => b.y + b.height)) + 4) - y };
}

/** Only endpoint comparisons exclude the independently ticking player timer.
 * A changed layout must never allow this exclusion to cover a target button.
 */
export function zhajinhuaOperationClockMasks(nodes: NativeNode[]): ScreenshotMask[] {
  const controls = mountedControls(nodes);
  return playerCountdownNodes(nodes, 'zhajinhua').map(timer => {
    const b = timer.bounds;
    if (controls.some(control => {
      const c = control.bounds;
      return b.x < c.x + c.width && c.x < b.x + b.width && b.y < c.y + c.height && c.y < b.y + b.height;
    })) throw new Error('操作按钮倒计时端点遮罩不得覆盖前景按钮');
    return { ...b, reason: '仅端点比较排除本人独立倒计时；完整原生录像与按钮中途帧保留' };
  });
}
