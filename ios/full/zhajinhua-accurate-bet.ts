import { setTimeout as delay } from 'node:timers/promises';
import type { NativeDevice, NativeNode } from './native-device';
import type { NativeNode as GameNode } from './game-controls';
import type { ScreenshotMask, ScreenshotBounds } from './screenshot';
import { visibleMasks } from './game-masks';
import { gameMaskPoint } from './game-mask-point';
import { zhajinhuaOperationControls } from './zhajinhua-operation-region';

const panelMarker = 'accurate-bet-popup-container';
const buttonMarker = 'zhajinhua-operation-accurate-bet-button';
type Screen = { width: number; height: number };
class AccurateBetBlockedError extends Error {}

function assertNoBlockingAlert(nodes: NativeNode[]): void {
  if (nodes.some(node => node.visible !== false && (node.res === 'common-alert-message'
    || node.clazz === 'XCUIElementTypeAlert' || /Connection Timeout/i.test(node.text || ''))))
    throw new AccurateBetBlockedError('精确加注阶段出现阻断错误弹窗；不能等待或重试动画掩盖错误');
}

function visible(nodes: NativeNode[], marker: string): NativeNode[] {
  return nodes.filter(node => node.res === marker && node.visible !== false
    && node.bounds.width > 0 && node.bounds.height > 0);
}

/** One completed observation proves the panel is absent and the full operation
 * controls are mounted. Reusing this observation avoids another slow AX query.
 */
export function accurateBetEntrance(nodes: NativeNode[], screen: Screen): GameNode {
  assertNoBlockingAlert(nodes);
  if (visible(nodes, panelMarker).length) throw new Error('精确加注入场前弹窗必须消失');
  if (nodes.some(node => /Connecting\.\.\./.test(node.text || ''))) throw new Error('精确加注准备时连接遮罩必须消失');
  return zhajinhuaOperationControls(nodes, screen).find(node => node.res === buttonMarker)!;
}

/** The close point and complete panel come from the same live observation. */
export function accurateBetPanel(nodes: NativeNode[], screen: Screen) {
  assertNoBlockingAlert(nodes);
  const panels = visible(nodes, panelMarker), masks = visible(nodes, 'screen-mask-touch-to-close');
  if (panels.length !== 1 || masks.length !== 1 || masks[0].enabled === false)
    throw new Error('精确加注必须有唯一真实弹窗和可点击关闭遮罩');
  const b = panels[0].bounds;
  if (b.x < 0 || b.y < 0 || b.x + b.width > screen.width || b.y + b.height > screen.height)
    throw new Error('精确加注弹窗必须完整位于屏幕内');
  return { panel: panels[0], close: gameMaskPoint(masks[0].bounds, b, screen) };
}

async function observe<T>(device: NativeDevice, validate: (nodes: NativeNode[]) => T) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const nodes = await device.nodes();
    try { return { ...validate(nodes), nodes, completedAt: Date.now() }; }
    catch (error) { if (error instanceof AccurateBetBlockedError || Date.now() >= deadline) throw error; await delay(250); }
  }
}

/** Each requested phase gets a fresh real turn. Cleanup is a separate setup
 * action, never a retry of a recorded entrance/exit. Driver failures propagate.
 */
export async function prepareAccurateBetEntrance(device: NativeDevice, beginTurn: () => Promise<unknown>) {
  const current = await device.nodes();
  assertNoBlockingAlert(current);
  if (visible(current, panelMarker).length) await device.input.tap(accurateBetPanel(current, device.screenSize).close);
  const turnStartedAt = Date.now();
  await beginTurn();
  const observation = await observe(device, nodes => ({ button: accurateBetEntrance(nodes, device.screenSize) }));
  return { ...observation, turnStartedAt, cleanedPreviousPanel: visible(current, panelMarker).length === 1 };
}

export async function readyAccurateBetPanel(device: NativeDevice) {
  return observe(device, nodes => accurateBetPanel(nodes, device.screenSize));
}

/** Mask only the native room clock at screenshot endpoints. Never alter raw
 * motion pixels or cover the keyboard when it obscures that background clock.
 */
export function accurateBetEndpointMasks(nodes: NativeNode[]): ScreenshotMask[] {
  const panels = visible(nodes, panelMarker);
  return visible(nodes, 'countdown-text').flatMap(clock => visibleMasks({ ...clock.bounds,
    reason: '精确加注端点的原生房间倒计时；弹窗前景与原片保持完整' }, clock, panels));
}

/** Four native pixels include the actual white outline and antialiased edge
 * seen in run39550461393. The fallback estimate cannot silently clip a panel.
 */
export function assertAccurateBetRegion(nodes: NativeNode[], screen: Screen, region: ScreenshotBounds): void {
  const b = accurateBetPanel(nodes, screen).panel.bounds;
  const left = Math.max(0, Math.floor(b.x) - 4), top = Math.max(0, Math.floor(b.y) - 4);
  const right = Math.min(screen.width, Math.ceil(b.x + b.width) + 4);
  const bottom = Math.min(screen.height, Math.ceil(b.y + b.height) + 4);
  if (region.x > left || region.y > top || region.x + region.width < right || region.y + region.height < bottom)
    throw new Error('精确加注截图区域必须覆盖完整原生弹窗及四像素绘制边缘');
}
