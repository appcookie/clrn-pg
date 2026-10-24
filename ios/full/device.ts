// 已发布模拟器包的会话生命周期与视觉产物；不构建或检出应用源码。
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, type TestInfo } from '@playwright/test';
import { WebDriver } from '../webdriver.mjs';
import { applicationId, readVerifiedBuild, artifactDirectory } from '../release.mjs';
import { extractSimulator } from '../extract-simulator.mjs';
import { comparePixels } from '../visual.mjs';
import { NativeDevice } from './native-device';
import { maskScreenshot, type ScreenshotMask, type ScreenshotBounds } from './screenshot';
import { baselinePath, baselineRoot } from './baseline-path.mjs';

export { applicationId };
export const artifacts = artifactDirectory;
let appPromise: Promise<string> | undefined;
export let appPath = '';
export async function simulatorAppPath(): Promise<string> {
  appPromise ||= extractSimulator(readVerifiedBuild());
  appPath = await appPromise;
  return appPath;
}
let nextDevice = 0;
let appium: { server: ChildProcess; url: string; users: number } | undefined;
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function acquireServer() {
  if (appium) { appium.users++; return appium; }
  const port = await freePort();
  const server = spawn(resolve('node_modules/.bin/appium'), ['--address', '127.0.0.1', '--port', String(port), '--log-level', 'warn'],
    { env: { ...process.env, APPIUM_HOME: resolve('.appium') }, stdio: ['ignore', 'ignore', 'inherit'] });
  const url = `http://127.0.0.1:${port}`;
  const driver = new WebDriver(url);
  try {
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null) throw new Error(`Appium 启动失败：${server.exitCode}`);
      try { await driver.request('GET', '/status', undefined, 5000); break; }
      catch (error) { if (attempt >= 119) throw error; await delay(500); }
    }
  } catch (error) { server.kill('SIGKILL'); throw error; }
  appium = { server, url, users: 1 };
  return appium;
}
async function releaseServer() {
  if (!appium || --appium.users > 0) return;
  const { server } = appium;
  appium = undefined;
  if (server.exitCode !== null || server.signalCode !== null) return;
  const done = new Promise<void>(resolve => server.once('exit', () => resolve()));
  server.kill('SIGTERM');
  const force = setTimeout(() => server.kill('SIGKILL'), 10_000);
  await Promise.race([done, delay(15_000)]);
  clearTimeout(force);
}
export async function launchApplication(options: { isolated?: boolean; gameDriver?: boolean; enableSystemAnimations?: boolean; microphonePermission?: boolean } = {}): Promise<NativeDevice> {
  if (process.platform !== 'darwin') throw new Error('原生测试需要 macOS Simulator。');
  const parent = process.env.IOS_SIMULATOR_UDID || '';
  if (!/^[\da-f-]{36}$/i.test(parent)) throw new Error('必须指定 IOS_SIMULATOR_UDID。');
  const index = nextDevice++;
  let udid = parent;
  if (options.isolated) {
    udid = execFileSync('xcrun', ['simctl', 'create', `clrn-isolated-${process.pid}-${index}`,
      'com.apple.CoreSimulator.SimDeviceType.iPhone-16', 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'], { encoding: 'utf8' }).trim();
  }
  let serverAcquired = false;
  let closed = false;
  let driver: WebDriver | undefined;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    try { if (driver?.session) await driver.request('DELETE', driver.path(), undefined, 30_000); }
    finally {
      if (serverAcquired) await releaseServer();
      if (options.isolated) execFileSync('xcrun', ['simctl', 'delete', udid], { timeout: 30_000 });
    }
  };
  try {
    const devices = JSON.parse(execFileSync('xcrun', ['simctl', 'list', '-j', 'devices'], { encoding: 'utf8' }));
    const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-18-5';
    const device = devices.devices[runtime]?.find((item: { udid: string }) => item.udid === udid);
    if (!device?.isAvailable || device.deviceTypeIdentifier !== 'com.apple.CoreSimulator.SimDeviceType.iPhone-16') {
      throw new Error('全量基准固定 iPhone 16 / iOS 18.5，请创建专用模拟器。');
    }
    const app = await simulatorAppPath();
    const server = await acquireServer();
    serverAcquired = true;
    driver = new WebDriver(server.url);
    const capabilities = { platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid,
      'appium:platformVersion': '18.5', 'appium:deviceName': 'iPhone 16', 'appium:app': app,
      'appium:bundleId': applicationId, 'appium:fullReset': true, 'appium:language': 'en', 'appium:locale': 'en_US',
      'appium:maxTypingFrequency': 8, 'appium:autoAcceptAlerts': false, 'appium:isHeadless': true, 'appium:waitForIdleTimeout': 0,
      'appium:appTimeZone': 'UTC',
      // 在安装后、首次启动前授权，避免运行中变更 TCC 权限终止当前牌桌进程。
      ...(options.microphonePermission ? { 'appium:permissions': JSON.stringify({ [applicationId]: { microphone: 'yes' } }) } : {}),
      // fullReset 会清空模拟器信任库；由 XCUITest 在 reset 后重装本轮临时 CA。
      ...(process.env.IOS_PROXY_CA_CERT ? { 'appium:customSSLCert': readFileSync(process.env.IOS_PROXY_CA_CERT, 'utf8') } : {}),
      'appium:simulatorStartupTimeout': 300_000,
      'appium:wdaLaunchTimeout': 240_000, 'appium:newCommandTimeout': 1800,
      'appium:wdaLocalPort': 8100 + index, 'appium:mjpegServerPort': 9100 + index };
    const start = async () => {
      await driver!.start(capabilities);
      // fullReset 也会清除先前 status_bar override，因此在会话建立后固定显示。
      execFileSync('xcrun', ['simctl', 'status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged',
        '--batteryLevel', '100', '--wifiBars', '3', '--cellularBars', '4']);
    };
    await start();
    const reset = async () => {
      await driver!.close();
      await start();
    };
    const native = new NativeDevice(driver, udid, cleanup, reset, applicationId);
    await native.initialize();
    return native;
  } catch (error) { await cleanup(); throw error; }
}
export async function waitForHall(device: NativeDevice) {
  await device.wait({ res: 'staging-confirmation-input' }, { timeout: 120_000 });
  await device.fill({ res: 'staging-confirmation-input' }, 'CONFIRM');
  await device.hideKeyboard();
  await device.tap({ res: 'confirm-button' });
  // Run 39817619684 returned from the first native tap with the staging
  // dialog and keyboard still visible. Only retry the reversible confirmation
  // when its original input and enabled button are still mounted.
  await delay(500);
  const settled = await device.nodes();
  if (!settled.some(node => node.res === 'settings-tab')
    && settled.some(node => node.res === 'staging-dialog-wrapper')) {
    const input = settled.find(node => node.res === 'staging-confirmation-input');
    const confirm = settled.find(node => node.res === 'confirm-button');
    if (input && confirm?.enabled) {
      await device.hideKeyboard();
      const current = await device.nodes();
      if (current.some(node => node.res === 'staging-dialog-wrapper')
        && current.some(node => node.res === 'staging-confirmation-input')
        && current.some(node => node.res === 'confirm-button' && node.enabled)
        && !current.some(node => node.clazz === 'XCUIElementTypeKeyboard')) {
        await device.tap({ res: 'confirm-button' });
      }
    }
  }
  await device.wait({ res: 'settings-tab' }, { timeout: 120_000 });
}
/** smoke 只采集，reference 生成独立 iOS 基准，compare 缺失基准或变化必须失败。 */
export async function assertVisual(bytes: Buffer, name: string, testInfo: TestInfo,
  comparisonExclusions: ScreenshotBounds[] = []) {
  const mode = process.env.IOS_VISUAL_MODE || 'smoke';
  if (!['smoke', 'reference', 'compare'].includes(mode)) throw new Error(`未知视觉模式：${mode}`);
  if (name.includes('..') || name.startsWith('/')) throw new Error('视觉产物名称不能越界。');
  const filename = name.endsWith('.png') ? name : `${name}.png`;
  await testInfo.attach(filename, { body: bytes, contentType: 'image/png' });
  // smoke 的合成算法测试也会调用此入口；仅真正存取基准时要求共享场景已归类。
  const baseline = mode === 'smoke' ? undefined : baselinePath(filename);
  if (mode === 'reference') {
    mkdirSync(dirname(baseline!), { recursive: true });
    writeFileSync(baseline!, bytes);
    writeFileSync(resolve(baselineRoot, 'build-info.json'), JSON.stringify(readVerifiedBuild(), null, 2));
  } else if (mode === 'compare') {
    if (!existsSync(baseline!)) {
      await testInfo.attach(`${filename}-actual`, { body: bytes, contentType: 'image/png' });
      throw new Error(`缺少已审查基准：${baseline}`);
    }
    const expected = readFileSync(baseline!);
    const comparison = comparePixels(expected, bytes, 12, comparisonExclusions);
    if (!comparison.matches) {
      // Attach the exact inputs used above, so historical reports remain
      // reviewable even after the repository baseline changes.
      await testInfo.attach(`${filename}-expected`, { body: expected, contentType: 'image/png' });
      await testInfo.attach(`${filename}-actual`, { body: bytes, contentType: 'image/png' });
      if (comparison.diff) await testInfo.attach(`${filename}-diff`, { body: comparison.diff, contentType: 'image/png' });
    }
    expect(comparison.matches, `${filename} 变化比例 ${comparison.changedRatio}`).toBe(true);
  }
}
export async function compareScreenshot(device: NativeDevice, name: string, testInfo: TestInfo,
  masks: ScreenshotMask[] = [], transientState?: () => Promise<void>, takeScreenshot: () => Promise<Buffer> = () => device.screenshot(),
  _alternateSnapshots: string[] = [], comparisonExclusions: ScreenshotBounds[] = [],
  nativeFallback = false) {
  if (masks.length) await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  await transientState?.();
  let previous = maskScreenshot(await takeScreenshot(), masks);
  let stableSince = Date.now();
  let result = previous;
  let original = previous;
  await expect(async () => {
    await transientState?.();
    original = await takeScreenshot();
    await transientState?.();
    result = maskScreenshot(original, masks);
    const match = comparePixels(previous, result).matches;
    if (!match) { previous = result; stableSince = Date.now(); }
    expect(match, '页面截图应稳定').toBe(true);
    expect(Date.now() - stableSince).toBeGreaterThanOrEqual(transientState ? 250 : 1500);
  }).toPass({ timeout: 30_000, intervals: [transientState ? 100 : 500] });
  if (nativeFallback && process.env.IOS_VISUAL_MODE === 'compare') {
    const reference = readFileSync(baselinePath(`${name}.png`));
    if (!comparePixels(reference, result, 12, comparisonExclusions).matches) {
      // XCTest can return a stable but clipped game layer after a recording.
      // Compare a fresh Simulator capture to the same reviewed baseline. The
      // only extra exclusion is iPhone 16's hardware Dynamic Island, which
      // Simulator draws black while XCTest omits it from screenshots.
      const island = { x: 400, y: 32, width: 379, height: 114 };
      if (device.screenSize.width === 1178 && device.screenSize.height === 2556) {
        const exclusions = [...comparisonExclusions, island];
        const fallbackOriginal = await device.nativeScreenshot();
        const fallback = maskScreenshot(fallbackOriginal, masks);
        if (comparePixels(reference, fallback, 12, exclusions).matches) {
          await testInfo.attach(`${name}-xctest-clipped`, { body: original, contentType: 'image/png' });
          original = fallbackOriginal;
          result = fallback;
          comparisonExclusions = exclusions;
        }
      }
    }
  }
  if (masks.length) await testInfo.attach(`${name}-original`, { body: original, contentType: 'image/png' });
  await assertVisual(result, name, testInfo, comparisonExclusions);
}
