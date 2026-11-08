import { flattenNodes, type NativeNode } from './game-controls';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { playerCountdownNodes } from './game-countdown';
import { setTimeout as delay } from 'node:timers/promises';
import { inside, overlaps, paddedRegion, positiveSize, screenBounds, type Screen } from './zhajinhua-region-geometry';

export const zhajinhuaOperationMarkers = [
  'zhajinhua-shortcut-raise-first', 'zhajinhua-shortcut-raise-second',
  'zhajinhua-shortcut-raise-third', 'zhajinhua-shortcut-raise-fourth',
  'zhajinhua-operation-button-battle', 'zhajinhua-operation-button-fold',
  'zhajinhua-operation-button-call', 'zhajinhua-operation-accurate-bet-button',
  'zhajinhua-delay-operation-button',
];

export function visibleZhajinhuaOperationControls(nodes: NativeNode[]): NativeNode[] {
  return nodes.filter(node => node.visible !== false).filter(operationControl)
    .filter(node => positiveSize(node.bounds));
}

function mountedControls(nodes: NativeNode[]): NativeNode[] {
  const parents = nodes.filter(node => node.res === 'zhajinhua-cancel-challenge-choosing' && node.visible !== false);
  if (parents.length > 1) throw new Error('操作区必须属于唯一取消选择原生容器');
  const scoped = [...new Set([...nodes, ...parents.flatMap(flattenNodes)])];
  return scoped.filter(operationControl).filter(node => positiveSize(node.bounds));
}

/** zoomInDown remounts only after all controls have actually disappeared. */
export function zhajinhuaOperationControls(nodes: NativeNode[], screen?: { width: number; height: number }): NativeNode[] {
  const visible = visibleZhajinhuaOperationControls(nodes);
  // Pinned MainScreen wraps the table in TouchableWithoutFeedback. After
  // Cancel its disabled=true makes XCTest report its still-rendered controls
  // visible=false. Read only this exact, visible, disabled parent subtree;
  // callers must also prove all nine controls' raw endpoint pixels and motion.
  const parent = cancelParent(nodes, screen);
  mountedControls(nodes); // Reject ambiguous visible parent containers.
  const controls = endpointControls(visible, parent);
  return zhajinhuaOperationMarkers.map(marker => {
    const found = controls.filter(node => node.res === marker);
    if (found.length !== 1) throw new Error(`操作按钮终点必须有唯一可见或取消后可验证的原生控件：${marker}`);
    return found[0];
  });
}

function operationControl(node: NativeNode): boolean {
  return zhajinhuaOperationMarkers.includes(node.res || '');
}

function cancelParent(nodes: NativeNode[], screen?: Screen): NativeNode | undefined {
  if (!screen) return undefined;
  return nodes.filter(node => node.res === 'zhajinhua-cancel-challenge-choosing')
    .filter(node => node.visible === true && node.enabled === false)
    .find(node => fullScreenParent(node.bounds, screen));
}

function fullScreenParent(b: ScreenshotBounds, screen: Screen): boolean {
  return b.x === 0 && b.y === 0 && sameSize(b, screen);
}

function sameSize(b: ScreenshotBounds, screen: Screen): boolean {
  return b.width === screen.width && b.height === screen.height;
}

function mountedEndpointControls(parent: NativeNode): NativeNode[] {
  const descendants = flattenNodes(parent);
  if (descendants.some(node => node.res === 'challenge_player_selector'))
    throw new Error('取消选择后不得残留挑战目标子树');
  return descendants.filter(operationControl)
    .filter(node => node.enabled === true && inside(node.bounds, parent.bounds));
}

function endpointControls(visible: NativeNode[], parent: NativeNode | undefined): NativeNode[] {
  // The selector must be rejected even when all nine controls are visible.
  const mounted = parent ? mountedEndpointControls(parent) : visible;
  if (visible.length === zhajinhuaOperationMarkers.length) return visible;
  return mounted;
}

/** Validate the entire prepared state from one completed native observation. */
export function zhajinhuaChallengeCancel(nodes: NativeNode[]): NativeNode {
  const visible = challengeTargets(nodes);
  const cancel = visible.filter(node => node.res === 'zhajinhua-cancel-challenge-choosing' && node.enabled !== false);
  if (cancel.length !== 1) throw new Error('必须有唯一可点击的取消选择区域');
  return cancel[0];
}

/** Driver reads retain their own deadline; only an incomplete observed state
 * is polled. A ready state needs one tree, never three independent queries.
 */
export async function readyZhajinhuaChallengeCancel<T extends NativeNode>(read: () => Promise<T[]>,
  timeout = 30_000, interval = 250): Promise<{ cancel: NativeNode; nodes: T[]; completedAt: number }> {
  return observeChallengeCancel(read, timeout, interval);
}

async function observeChallengeCancel<T extends NativeNode>(read: () => Promise<T[]>, timeout: number, interval: number) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const nodes = await read();
    try { return { cancel: zhajinhuaChallengeCancel(nodes), nodes, completedAt: Date.now() }; }
    catch (error) { await retryChallengeObservation(error, deadline, interval); }
  }
}

async function retryChallengeObservation(error: unknown, deadline: number, interval: number): Promise<void> {
  if (Date.now() >= deadline) throw error;
  await delay(interval);
}

/** Include the four shortcuts, three main buttons, accurate-bet and delay
 * controls. The former estimate clipped the shortcuts and both lower rows.
 */
export function zhajinhuaOperationRegion(before: NativeNode[], after: NativeNode[],
  screen: { width: number; height: number }): ScreenshotBounds {
  assertOperationStart(before, after);
  const bounds = zhajinhuaOperationControls(after, screen).map(node => node.bounds);
  if (bounds.some(b => !inside(b, screenBounds(screen))))
    throw new Error('操作按钮必须完整位于原生屏幕内');
  return paddedRegion(bounds, screen);
}

/** Only endpoint comparisons exclude the independently ticking player timer.
 * A changed layout must never allow this exclusion to cover a target button.
 */
export function zhajinhuaOperationClockMasks(nodes: NativeNode[]): ScreenshotMask[] {
  const controls = mountedControls(nodes);
  return playerCountdownNodes(nodes, 'zhajinhua').map(timer => {
    const b = timer.bounds;
    if (controls.some(control => overlaps(b, control.bounds))) throw new Error('操作按钮倒计时端点遮罩不得覆盖前景按钮');
    return { ...b, reason: '仅端点比较排除本人独立倒计时；完整原生录像与按钮中途帧保留' };
  });
}

function challengeTargets(nodes: NativeNode[]): NativeNode[] {
  if (mountedControls(nodes).length) throw new Error('选择对手时全部9个操作控件必须消失');
  const visible = nodes.filter(node => node.visible !== false).filter(node => positiveSize(node.bounds));
  if (visible.filter(node => node.res === 'challenge_player_selector').length !== 4)
    throw new Error('选择对手时必须有4个真实挑战目标');
  return visible;
}

function assertOperationStart(before: NativeNode[], after: NativeNode[]): void {
  if (mountedControls(before).length)
    throw new Error('操作按钮入场起点必须全部消失，已显示的按钮不能重复恢复冒充入场');
  if (after.some(node => node.visible !== false && node.res === 'challenge_player_selector'))
    throw new Error('取消选择后不得残留挑战目标');
}
