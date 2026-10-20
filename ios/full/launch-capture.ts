import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { normalizeNativeScreenshot, type NativeNode } from './native-device';
import { launchArtworkMatch } from './launch-artwork';
import { launchBrandPixelBounds } from './web-animation-parity';

const execFileAsync = promisify(execFile);

/** 独立 simctl 进程与 WDA 树查询并行，不能用同步截图阻塞网络释放定时器。 */
export async function launchScreenshot(udid: string, size: { width: number; height: number }) {
  const { stdout } = await execFileAsync('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', '--mask=ignored', '-'],
    { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
  return normalizeNativeScreenshot(stdout, size);
}

/** 只采一轮真实图/树；读取慢时也先释放 hold，是否有效由实际图/树证明。 */
export async function captureLaunchBranding(operations: {
  nodes: () => Promise<NativeNode[]>; screenshot: () => Promise<Buffer>; release: () => Promise<unknown>;
}, releaseAfterMs = 4_000) {
  const started = Date.now();
  let releasePromise: Promise<void> | undefined;
  let releaseFailure: unknown;
  let releasedByBudget = false;
  const release = () => releasePromise ??= operations.release().then(() => {}, error => { releaseFailure = error; });
  // 应用健康检查自身超时为5秒；不能为了等截图稳定而继续故意阻塞它。
  const timer = setTimeout(() => { releasedByBudget = true; void release(); }, releaseAfterMs);
  try {
    const [nodes, bytes] = await Promise.allSettled([operations.nodes(), operations.screenshot()]);
    if (nodes.status === 'rejected') throw nodes.reason;
    if (bytes.status === 'rejected') throw bytes.reason;
    return { nodes: nodes.value, bytes: bytes.value, elapsedMs: Date.now() - started, releasedByBudget };
  } finally {
    clearTimeout(timer);
    await release();
    if (releaseFailure) throw releaseFailure;
  }
}

/** 离线核对真实全屏画面；绝不排除系统Alert或Staging卡片覆盖的区域。 */
export function verifyLaunchCapture(bytes: Buffer, nodes: NativeNode[], size: { width: number; height: number }, reference: PNG) {
  if (!nodes.some(node => node.res === 'launch-screen-container' && node.visible !== false)) throw new Error('没有可见的启动品牌页');
  if (nodes.some(node => node.res === 'staging-dialog' && node.visible !== false)) throw new Error('启动画面仍被Staging提示覆盖');
  if (nodes.some(node => node.clazz === 'XCUIElementTypeAlert' && node.visible !== false)) throw new Error('不能把系统错误弹窗当品牌页');
  const picture = PNG.sync.read(bytes);
  if (picture.width !== size.width || picture.height !== size.height) throw new Error('启动画面必须保留真实全屏尺寸');
  const brand = launchBrandPixelBounds(nodes, size);
  const artwork = launchArtworkMatch(picture, reference, [brand,
    { x: 0, y: 0, width: size.width, height: Math.ceil(size.height * .08) },
    { x: 0, y: Math.floor(size.height * .96), width: size.width, height: Math.ceil(size.height * .04) }]);
  if (!artwork.matches || artwork.gain < .9) throw new Error('截图不是完整无遮挡的发布包启动插画');
  let ink = 0, pixels = 0;
  for (let y = Math.ceil(brand.y); y < brand.y + brand.height; y++) {
    for (let x = Math.ceil(brand.x); x < brand.x + brand.width; x++) {
      const offset = (y * picture.width + x) * 4;
      // 白字叠在蓝色插画上时，蓝通道已很亮；至少两个通道须有真实文字对比。
      if ([0, 1, 2].filter(channel => picture.data[offset + channel] - reference.data[offset + channel] > 24).length >= 2) ink++;
      pixels++;
    }
  }
  if (ink < pixels * .03) throw new Error('启动页缺少真实可见的品牌文字像素');
  return { artwork, brand, brandInkRatio: ink / pixels };
}
