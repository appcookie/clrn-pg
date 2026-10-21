import { PNG } from 'pngjs';
import type { NativeDevice as AndroidDevice, NativeNode } from './native-device';
import type { VisualScenario } from '../../visual/scenarioTypes';
import { nativeSelector } from './scenarios';
import { setTimeout } from 'node:timers/promises';
import { caretMask } from './caret-mask';

export type ScreenshotMask = { x: number; y: number; width: number; height: number; reason: string; unverifiedLayout?: boolean };
export type ScreenshotBounds = Omit<ScreenshotMask, 'reason'>;

/**
 * 从两帧真实截图识别聚焦输入框的光标，保留原输入边界以适配键盘收起后的窗口位移。
 * @param device - 专用模拟器连接。
 */
export async function focusedCaretMask(device: AndroidDevice, readySnapshot?: NativeNode[]) {
  const inputClass = /XCUIElementType(?:Secure)?TextField|XCUIElementTypeTextView/;
  let input = readySnapshot
    ? readySnapshot.find(node => inputClass.test(node.clazz) && node.focused)
    : await device.info({ clazz: inputClass, focused: true }).catch(error => { if (error?.code === 'no such element') return undefined; throw error; });
  if (input) {
    let before = await device.screenshot();
    // 键盘转场会改变输入框边界；重建基准帧，并用不同采样间隔避免与光标周期重合。
    for (const delay of [137, 263, 419, 181, 347, 223, 389, 157, 293, 431, 199, 317]) {
      await setTimeout(delay);
      const after = await device.screenshot();
      const current = await device.info({ clazz: /XCUIElementType(?:Secure)?TextField|XCUIElementTypeTextView/, focused: true });
      const stable = current.text === input.text && JSON.stringify(current.bounds) === JSON.stringify(input.bounds);
      const mask = stable ? caretMask(before, after, input.bounds) : undefined;
      if (mask) return { mask, input };
      before = after;
      input = current;
    }
  }
}

/**
 * 仅排除版本、日期和自动轮播帧，原始截图仍附在报告中供检查。
 * @param device - 专用模拟器连接。
 * @param scenario - 共用的页面场景。
 * @param backgroundBanner - 打开原生弹窗前保存的背景横幅边界。
 */
export async function screenshotMasks(device: AndroidDevice, scenario: VisualScenario, backgroundBanner?: ScreenshotBounds,
  readySnapshot?: NativeNode[]): Promise<ScreenshotMask[]> {
  const masks: ScreenshotMask[] = [];
  const caret = await focusedCaretMask(device, readySnapshot);
  if (caret) masks.push(caret.mask);
  for (const rule of scenario.fixedTexts) {
    if (!/(?:version-text|current-server-text|checkInDetailDate)/.test(rule.selector)) continue;
    const node = await device.info(nativeSelector(rule.selector)).catch(error => { if (error?.code === 'no such element') return undefined; throw error; });
    if (node && node.bounds.width > 0 && node.bounds.height > 0) {
      masks.push({ ...node.bounds, reason: rule.selector });
    }
  }
  if (['signed_in_hall', 'signed_in_hall_match', 'search_sign_in_prompt', 'guest_game_sign_in_prompt'].includes(scenario.pageLabel)) {
    const banner = backgroundBanner || (await device.info({ res: 'slot-banner' }).catch(error => { if (error?.code === 'no such element') return undefined; throw error; }))?.bounds;
    if (banner) {
      const { x, y, width, height } = banner;
      masks.push({ x: x + width * 0.52, y: y + height * 0.16, width: width * 0.4, height: height * 0.48,
        reason: '拉霸横幅自动轮播的三个图案；横幅文字、布局和按钮仍比较' });
    }
  }
  return masks;
}

/**
 * 给明确列出的动态区域加可见遮罩；拒绝过大的遮罩掩盖整页布局。
 * @param bytes - 原始 PNG 截图。
 * @param masks - 已从真实控件计算出的动态区域。
 */
export function maskScreenshot(bytes: Buffer, masks: ScreenshotMask[]): Buffer {
  // 不能把 Android 按屏幕比例推测的遮罩直接用于 iOS；未校准区域保留全部原像素。
  masks = masks.filter(mask => !mask.unverifiedLayout);
  if (!masks.length) return bytes;
  const picture = PNG.sync.read(bytes);
  applyScreenshotMasks(picture, masks);
  return PNG.sync.write(picture);
}

/** Apply the same screen-coordinate masks to decoded pixels before cropping.
 * The 12% limit always uses the original full screenshot, including off-crop masks.
 */
export function applyScreenshotMasks(picture: Pick<PNG, 'width' | 'height' | 'data'>, masks: ScreenshotMask[]): void {
  const rectangles = clippedMasks(picture, masks);
  assertMaskArea(picture, rectangles);
  paintMasks(picture, rectangles);
}

/** 对局部基准使用全屏原图核验12%面积门槛，再平移同一批实际遮罩；不改变遮罩内容。
 * 39618764089 的160×162倒计时占409×449裁图的14.1%，但占1178×2556全屏不到1%。
 */
export function maskCroppedScreenshot(bytes: Buffer, fullScreen: Buffer, masks: ScreenshotMask[], region: ScreenshotBounds): Buffer {
  const screen = PNG.sync.read(fullScreen), picture = PNG.sync.read(bytes);
  if (![region.x, region.y, region.width, region.height].every(Number.isInteger)
    || region.x < 0 || region.y < 0 || region.x + region.width > screen.width || region.y + region.height > screen.height
    || picture.width !== region.width || picture.height !== region.height) throw new Error('局部遮罩必须使用原始全屏内的真实裁图范围');
  const rectangles = clippedMasks(screen, masks);
  assertMaskArea(screen, rectangles);
  paintMasks(picture, clippedMasks(picture, rectangles.map(mask => ({ ...mask,
    x: mask.x - region.x, y: mask.y - region.y }))));
  return PNG.sync.write(picture);
}

function clippedMasks(picture: { width: number; height: number }, masks: ScreenshotMask[]): ScreenshotMask[] {
  return masks.filter(mask => !mask.unverifiedLayout).map(mask => {
    const x = Math.max(0, Math.floor(mask.x)), y = Math.max(0, Math.floor(mask.y));
    const right = Math.min(picture.width, Math.ceil(mask.x + mask.width));
    const bottom = Math.min(picture.height, Math.ceil(mask.y + mask.height));
    return { ...mask, x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  });
}

function assertMaskArea(picture: { width: number; height: number }, masks: ScreenshotBounds[]) {
  const area = masks.reduce((sum, mask) => sum + mask.width * mask.height, 0);
  if (area > picture.width * picture.height * 0.12) throw new Error('动态遮罩超过截图面积的 12%，需要重新检查覆盖范围。');
}

function paintMasks(picture: Pick<PNG, 'width' | 'height' | 'data'>, masks: ScreenshotBounds[]) {
  for (const mask of masks) for (let y = mask.y; y < mask.y + mask.height; y++)
    for (let x = mask.x; x < mask.x + mask.width; x++) {
      const offset = (y * picture.width + x) * 4;
      picture.data[offset] = 230;
      picture.data[offset + 1] = 210;
      picture.data[offset + 2] = 235;
      picture.data[offset + 3] = 255;
    }
}
