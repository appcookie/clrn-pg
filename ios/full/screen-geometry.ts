import type { NativeDevice } from './native-device';
import type { ScreenshotBounds } from './screenshot';

/** 无独立 testID 的粒子/飞行区域暂用相对屏幕坐标；这些后备区域尚未经过 iOS 原生录屏校准。
 * 截图从不缩放。历史固定遮罩明确标记未校准，maskScreenshot 不启用它们，防止遮住错误内容。 */
export function screenBounds<T extends ScreenshotBounds>(device: NativeDevice, region: T): T {
  const { width, height } = device.screenSize;
  const x = Math.round(region.x * width / 720), y = Math.round(region.y * height / 1280);
  return { ...region, ...('reason' in region ? { unverifiedLayout: true } : {}), x, y,
    width: Math.round((region.x + region.width) * width / 720) - x,
    height: Math.round((region.y + region.height) * height / 1280) - y };
}

/** 按当前截图映射历史布局中的无 ID 手势位置。 */
export function screenPoint(device: NativeDevice, x: number, y: number) {
  return { x: Math.round(x * device.screenSize.width / 720), y: Math.round(y * device.screenSize.height / 1280) };
}
