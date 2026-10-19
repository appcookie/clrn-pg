// 启动指定模拟器和 Appium，执行原生页面断言、截图并在失败时保存控件树。
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { WebDriver } from './webdriver.mjs';
import { applicationId, readVerifiedBuild } from './release.mjs';
import { selectScenarios } from './scenarios.mjs';

const mode = process.env.IOS_VISUAL_MODE || 'smoke';
if (!['smoke', 'reference', 'compare'].includes(mode)) throw new Error('IOS_VISUAL_MODE 应为 smoke、reference 或 compare。');
const selectedScenarios = selectScenarios(process.env.IOS_FILTER);
const udid = process.env.IOS_SIMULATOR_UDID || '';
if (!/^[A-Fa-f0-9-]{36}$/.test(udid)) throw new Error('必须指定专用模拟器 IOS_SIMULATOR_UDID。');
const information = readVerifiedBuild();
const manifestPath = resolve('ios/artifacts/simulator-app.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath)) : undefined;
const app = resolve(manifest?.app || '');
if (!existsSync(join(app, 'Info.plist'))) throw new Error('缺少 iOS Simulator .app；先运行 build-simulator.mjs。');
if (manifest?.applicationCommit !== information.applicationCommit
  || manifest?.releaseTag !== information.releaseTag) throw new Error('模拟器应用构建身份与 Release 不一致。');
const identifier = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', join(app, 'Info.plist')],
  { encoding: 'utf8' }).trim();
if (identifier !== applicationId) throw new Error(`应用 bundle identifier 错误：${identifier}`);
const binaryName = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleExecutable', join(app, 'Info.plist')],
  { encoding: 'utf8' }).trim();
const platform = execFileSync('xcrun', ['vtool', '-show-build', join(app, binaryName)], { encoding: 'utf8' });
if (!platform.includes('IOSSIMULATOR')) throw new Error('提供的 .app 并非 iOS Simulator 构建。');
const devices = JSON.parse(execFileSync('xcrun', ['simctl', 'list', '-j', 'devices'], { encoding: 'utf8' }));
const simulator = Object.values(devices.devices).flat().find(device => device.udid === udid);
if (!simulator || !simulator.isAvailable) throw new Error(`找不到可用的指定模拟器：${udid}`);
if (simulator.state !== 'Booted') execFileSync('xcrun', ['simctl', 'boot', udid]);
execFileSync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'inherit', timeout: 180_000 });
execFileSync('xcrun', ['simctl', 'status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged',
  '--batteryLevel', '100', '--wifiBars', '3', '--cellularBars', '4']);
const results = resolve('ios/artifacts/results');
const snapshots = resolve('ios/snapshots');
mkdirSync(results, { recursive: true });
const appiumHome = resolve('.appium');
const server = spawn(resolve('node_modules/.bin/appium'), ['--address', '127.0.0.1', '--port', '4723',
  '--log', join(results, 'appium.log')], { env: { ...process.env, APPIUM_HOME: appiumHome }, stdio: 'ignore' });
const driver = new WebDriver();
let failures = 0;
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`Appium 启动失败：${server.exitCode}`);
    try { await driver.request('GET', '/status'); break; }
    catch (error) { if (attempt === 119) throw error; await delay(500); }
  }
  await driver.start({ platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid,
    'appium:app': app, 'appium:bundleId': applicationId, 'appium:noReset': false,
    'appium:language': 'en', 'appium:locale': 'en_US',
    'appium:autoAcceptAlerts': true, 'appium:wdaLaunchTimeout': 120_000,
    'appium:newCommandTimeout': 180 });
  await driver.find('staging-confirmation-input', 120_000);
  await driver.fill('staging-confirmation-input', 'CONFIRM');
  await driver.tap('confirm-button');
  await driver.find('settings-tab', 120_000);
  for (const scenario of selectedScenarios) {
    try {
      await driver.tap(scenario.tab);
      for (const click of scenario.clicks || []) await driver.tap(click);
      await driver.find(scenario.ready);
      await delay(1500);
      const screenshot = await driver.screenshot();
      if (screenshot.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('模拟器截图不是 PNG。');
      const filename = `${scenario.name}.png`;
      writeFileSync(join(results, filename), screenshot);
      if (mode === 'reference') {
        mkdirSync(snapshots, { recursive: true });
        writeFileSync(join(snapshots, filename), screenshot);
      } else if (mode === 'compare') {
        const baseline = join(snapshots, filename);
        if (!existsSync(baseline) || !samePixels(readFileSync(baseline), screenshot)) {
          throw new Error(`截图基准缺失或像素不一致：${baseline}`);
        }
      }
      console.log(`PASS ${scenario.name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${scenario.name}: ${error.message}`);
      await driver.screenshot().then(bytes => writeFileSync(join(results, `${scenario.name}-failed.png`), bytes)).catch(() => {});
      await driver.source().then(xml => writeFileSync(join(results, `${scenario.name}-source.xml`), xml)).catch(() => {});
      break;
    }
  }
} catch (error) {
  await driver.screenshot().then(bytes => writeFileSync(join(results, 'setup-failed.png'), bytes)).catch(() => {});
  await driver.source().then(xml => writeFileSync(join(results, 'setup-source.xml'), xml)).catch(() => {});
  throw error;
} finally {
  await driver.close().catch(error => console.error(`关闭会话失败：${error.message}`));
  server.kill('SIGTERM');
  execFileSync('xcrun', ['simctl', 'status_bar', udid, 'clear']);
}
if (failures) process.exitCode = 1;

function samePixels(firstBytes, secondBytes) {
  const first = PNG.sync.read(firstBytes);
  const second = PNG.sync.read(secondBytes);
  return first.width === second.width && first.height === second.height && first.data.equals(second.data);
}
