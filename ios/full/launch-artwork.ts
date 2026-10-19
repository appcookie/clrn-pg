import { assertVisual } from './device';
import { readFileSync } from 'node:fs';
import { expect, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { frameColorDistance } from './animation-transition';
import { motionParts } from './motion-regions';
import { maskScreenshot } from './screenshot';

/**
 * Staging 弹窗出现前，锁定应用自己的插画；排除系统 Splash 和桌面。
 * @param frames - 冷启动期间采集的完整原生屏幕。
 * @param testInfo - 保存和比较关键帧的测试信息。
 */
export async function verifyLaunchArtwork(frames: Buffer[], testInfo: TestInfo): Promise<void> {
  const full = PNG.sync.read(frames[0]);
  const scaleX = full.width / 720, scaleY = full.height / 1280;
  const region = { x: Math.round(70 * scaleX), y: Math.round(155 * scaleY),
    width: Math.round(580 * scaleX), height: Math.round(900 * scaleY) };
  const artwork = frames.map(frame => motionParts(frame, [region]).regions[0]);
  /**
   * 判断截图是否处在应用插画可见的蓝色阶段。
   * @param frame - 已裁切并遮蔽桌面时钟的启动截图。
   */
  const isArtwork = (frame: Buffer) => {
    const picture = PNG.sync.read(frame);
    const reds = [100, 200, 300, 400, 500].map(x => picture.data[(Math.round(90 * scaleY) * picture.width + Math.round(x * scaleX)) * 4]);
    const center = (Math.round(90 * scaleY) * picture.width + Math.round(300 * scaleX)) * 4;
    // 系统 Splash 是均匀蓝底，桌面与弹窗在这个位置没有应用插画的蓝色。
    return picture.data[center] < 160 && picture.data[center + 1] >= 120
      && picture.data[center + 2] >= 200 && Math.max(...reds) - Math.min(...reds) > 8;
  };
  const first = artwork.find(isArtwork);
  expect(first, '必须看到应用自己的启动插画').toBeDefined();
  const name = 'native-launch-artwork-visible.png';
  await testInfo.attach(name, { body: first!, contentType: 'image/png' });
  if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(first!, name, testInfo);
  else {
    const reference = readFileSync(testInfo.snapshotPath(name));
    expect(Math.min(...artwork.filter(isArtwork).map(candidate => frameColorDistance(candidate, reference))),
      `${name} 须在真实启动帧里接近已审查的插画`).toBeLessThanOrEqual(12);
  }
}
