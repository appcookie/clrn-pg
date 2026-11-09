import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { subtractPanel } from './game-masks';
import { texasRaiseControls } from './texas-raise-region';

import { contains, type Screen } from './texas-animation-geometry';
import { descendants, thumbImage, visibleRaiseRoot, rulerWithin, rulerLeaves, type RaiseNode as NativeNode } from './texas-animation-raise-tree';

/** Only the room clock is independent of the raise gesture. Hidden UIKit
 * accessibility does not make these background pixels disappear. Keep every
 * actual foreground rail segment, scale label, thumb and button unmasked.
 */
export function texasRaiseClockMasks(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotMask[] {
  const all = descendants(nodes);
  const b = roomClockBounds(all, screen);
  let masks: ScreenshotMask[] = [{ ...b, reason: '原生房间倒计时独立跳秒；加注前景仍完整比较' }];
  const roots = all.filter(visibleRaiseRoot);
  if (!roots.length) return masks;
  if (roots.length !== 1) throw new Error('加注遮罩必须只对应一个实际面板');
  return protectRaiseForeground(masks, nodes, roots[0], screen);
}
function protectRaiseForeground(masks: ScreenshotMask[], nodes: NativeNode[], root: NativeNode, screen: Screen) {
  const controls = texasRaiseControls(nodes);
  const rulers = descendants([root]).filter(node => rulerWithin(node, controls.slider.bounds));
  if (rulers.length !== 1) throw new Error('必须找到滑块内唯一原生刻度尺');
  const leaves = rulerLeaves(rulers[0], screen.width / 1178);
  const protectedBounds = [...leaves.map(node => node.bounds), thumbImage(nodes, screen).image,
    controls.cancel.bounds, controls.confirm.bounds];
  for (const bounds of protectedBounds) masks = masks.flatMap(mask => subtractPanel(mask, {
    x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2,
  }));
  return masks;
}

/** The native gold image supplies a fixed text slot for 1–4 digit values.
 * Only endpoint comparison uses it; the image border, pointer, thumb position
 * and all raw video/PNG pixels remain available to the movement gate.
 */
export function texasRaiseValueMask(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotMask[] {
  const { image, value } = thumbImage(nodes, screen);
  const { slider, thumb, cancel, confirm } = texasRaiseControls(nodes);
  const rulers = descendants(nodes.filter(node => node.res === 'raise-bet-popup'))
    .filter(node => rulerWithin(node, slider.bounds));
  const x = Math.ceil(image.x + image.width / 6), right = Math.floor(image.x + image.width * 5 / 6);
  const y = Math.ceil(image.y + image.height * 0.18), bottom = Math.floor(image.y + image.height * 0.82);
  const bounds = { x, y, width: right - x, height: bottom - y };
  validateValueSlot(bounds, value.bounds, rulers);
  if (Math.abs(image.y - thumb.bounds.y) > 2 || [cancel, confirm].some(node => overlapsSlot(bounds, node.bounds)))
    throw new Error('加注数字槽必须覆盖完整文字且不遮刻度、轨道或按钮');
  return [{ ...bounds, reason: '实际金色滑块内部固定数字槽；数值另断言，外框和滑块位置保持比较' }];
}

function overlapsSlot(bounds: ScreenshotBounds, button: ScreenshotBounds) {
  return subtractPanel({ ...bounds, reason: '' }, button)
    .reduce((area, part) => area + part.width * part.height, 0) !== bounds.width * bounds.height;
}
function validateValueSlot(bounds: ScreenshotBounds, value: ScreenshotBounds, rulers: NativeNode[]) {
  const message = '加注数字槽必须覆盖完整文字且不遮刻度、轨道或按钮';
  if (!contains(bounds, value) || rulers.length !== 1) throw new Error(message);
  validateSlotBesideRuler(bounds, rulers[0].bounds, message);
}
function validateSlotBesideRuler(bounds: ScreenshotBounds, ruler: ScreenshotBounds, message: string) {
  if (bounds.x <= ruler.x + ruler.width) throw new Error(message);
}
function roomClockBounds(all: NativeNode[], screen: Screen) {
  const clocks = all.filter(node => node.res === 'countdown-text');
  const icons = all.filter(node => node.clazz === 'XCUIElementTypeImage'
    && node.res?.endsWith('/room-profile/resource/image/icon_room_countdown_green@3x.png'));
  if (clocks.length !== 1 || icons.length !== 1) throw new Error('加注背景必须有唯一原生房间倒计时及其图标');
  validateClock(clocks[0], icons[0].bounds, screen);
  return clocks[0].bounds;
}
function validateClock(clock: NativeNode, icon: ScreenshotBounds, screen: Screen) {
  const b = clock.bounds, s = screen.width / 1178;
  const size = [b.height <= 60 * s, b.width <= 240 * s, icon.width <= 55 * s, icon.height <= 55 * s];
  const position = [b.x >= icon.x + icon.width, b.x - icon.x - icon.width <= 12 * s,
    Math.abs(b.y + b.height / 2 - icon.y - icon.height / 2) <= 6 * s];
  const fullScreen = { x: 0, y: 0, ...screen };
  if (![/^\d{2}:\d{2}:\d{2}$/.test(clock.text || ''), contains(fullScreen, b), contains(fullScreen, icon),
    size.every(Boolean), position.every(Boolean)].every(Boolean))
    throw new Error('房间倒计时必须是原生图标右侧的完整单行文字');
}
