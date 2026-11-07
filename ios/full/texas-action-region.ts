import { flattenNodes, type NativeNode } from './game-controls';
import { playerCountdownNodes } from './game-countdown';
import { overlaps, paddedRegion, withinScreen } from './texas-animation-geometry';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

export const texasOperationMarkers = [
  ...['half_pot', 'two_thirds_pot', 'double_pot', 'minimum_pot'].map(key => `texas-holdem-shortcut-raise-button-${key}`),
  ...['raise', 'fold', 'call'].map(key => `texas-holdem-operation-button-${key}`),
  'texas-holdem-operation-accurate-bet-button', 'texas-holdem-delay-operation-button',
];
const autoMarkers = ['Any Call', 'Check/Fold', 'Check'].map(key => `texas-holdem-auto-button-${key}`);
const visible = (node: NativeNode) => node.visible !== false && node.bounds.width > 0 && node.bounds.height > 0;
function unique(nodes: NativeNode[], marker: string): NativeNode {
  const matches = nodes.filter(node => visible(node) && node.res === marker);
  if (matches.length !== 1) throw new Error(`必须有唯一完整可见原生控件：${marker}`);
  return matches[0];
}
function union(nodes: NativeNode[], screen: { width: number; height: number }, padding = 4): ScreenshotBounds {
  const bounds = nodes.map(node => node.bounds);
  if (![bounds.length > 0, bounds.every(b => withinScreen(b, screen))].every(Boolean))
    throw new Error('动画目标必须完整位于原生屏幕内');
  return paddedRegion(bounds, screen, padding);
}
export function texasOperationControls(nodes: NativeNode[]): NativeNode[] {
  return texasOperationMarkers.map(marker => unique(nodes, marker));
}
export function texasOperationRegion(before: NativeNode[], after: NativeNode[], screen: { width: number; height: number }) {
  if (before.some(node => visible(node) && texasOperationMarkers.includes(node.res || '')))
    throw new Error('本人操作按钮入场起点必须消失');
  const auto = autoMarkers.map(marker => unique(before, marker));
  if (after.some(node => visible(node) && autoMarkers.includes(node.res || '')))
    throw new Error('本人操作按钮终点不得残留自动操作按钮');
  return union([...auto.flatMap(flattenNodes).filter(visible), ...texasOperationControls(after)], screen);
}
/** New shortcut buttons occupy a distinct region from the outgoing auto
 * controls. Motion here cannot be supplied by their disappearance alone. */
export function texasShortcutMotionBounds(before: NativeNode[], after: NativeNode[], screen: { width: number; height: number }) {
  const bounds = union(texasOperationControls(after).slice(0, 4), screen, 0);
  if (before.filter(node => visible(node) && /^texas-holdem-auto-button/.test(node.res || ''))
    .some(node => overlaps(bounds, node.bounds))) throw new Error('新快捷筹码运动区不得覆盖起点自动按钮');
  return bounds;
}

/** Resolve the exact acting player's subtree: other seats can already show
 * the same action label and must never supply this animation's bounds. */
export function texasPlayerAction(name: string, before: NativeNode[], after: NativeNode[]) {
  const action = playerActionName(name);
  const players = before.filter(node => visible(node) && /^texas-holdem-player-container-.+-operating$/.test(node.res || ''));
  if (players.length !== 1) throw new Error('玩家动作起点必须有唯一当前行动玩家');
  return playerActionTarget(players[0], action, after);
}
function playerActionName(name: string) {
  const action = /^texas-player-action-(call|raise|check|fold)$/.exec(name)?.[1];
  if (!action) throw new Error('未知德州玩家动作');
  return action;
}
function playerActionTarget(player: NativeNode, action: string, after: NativeNode[]) {
  const marker = `texas-holdem-player-action-${action}`;
  if (flattenNodes(player).some(node => visible(node) && node.res === marker))
    throw new Error('目标玩家动作标签起点必须消失');
  const id = player.res!.replace(/-operating$/, '');
  const targets = after.filter(node => visible(node) && (node.res === id || node.res === `${id}-operating`));
  if (targets.length !== 1) throw new Error('玩家动作终点必须保留同一玩家');
  return { player: targets[0], action: unique(flattenNodes(targets[0]), marker) };
}
export function texasPlayerActionRegion(name: string, before: NativeNode[], after: NativeNode[], screen: { width: number; height: number }) {
  const { action } = texasPlayerAction(name, before, after);
  return union(flattenNodes(action).filter(visible), screen);
}
/** Only the part extending outside the avatar can establish target motion.
 * A disappearing countdown over the avatar is not a bubble zoom phase. */
export function texasPlayerActionMotionBounds(name: string, before: NativeNode[], after: NativeNode[]) {
  const { player, action } = texasPlayerAction(name, before, after);
  const p = player.bounds, a = action.bounds;
  const left = { x: a.x, y: a.y, width: Math.min(a.x + a.width, p.x) - a.x, height: a.height };
  const right = { x: Math.max(a.x, p.x + p.width), y: a.y,
    width: a.x + a.width - Math.max(a.x, p.x + p.width), height: a.height };
  const region = [left, right].sort((a, b) => b.width - a.width)[0];
  if (region.width <= 0) throw new Error('动作标签必须有头像之外的独立可见运动区域');
  return region;
}

/** Endpoint-only timer exclusions, checked against the visible foreground
 * at that endpoint; raw intermediate frames retain every pixel. */
export function texasActionClockMasks(nodes: NativeNode[]): ScreenshotMask[] {
  const foreground = nodes.filter(visible).filter(actionForeground);
  return playerCountdownNodes(nodes, 'texas-holdem').map(timer => {
    if (foreground.some(node => overlaps(timer.bounds, node.bounds)))
      throw new Error('倒计时端点遮罩不得覆盖可见动作或操作按钮');
    return { ...timer.bounds, reason: '仅端点比较排除原生玩家倒计时；动作前景和原始中途帧完整保留' };
  });
}

function actionForeground(node: NativeNode) {
  const resource = node.res || '';
  return texasOperationMarkers.includes(resource) || /^texas-holdem-player-action-(call|raise|check|fold)$/.test(resource);
}
