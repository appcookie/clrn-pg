// 启动指定模拟器和 Appium，执行原生页面断言、截图并在失败时保存控件树。
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { comparePixels } from './visual.mjs';
import { recordAnimation } from './recording.mjs';
import { WebDriver } from './webdriver.mjs';
import { applicationId, readVerifiedBuild } from './release.mjs';
import { selectScenarios } from './scenarios.mjs';
import { extractSimulator } from './extract-simulator.mjs';

const mode = process.env.IOS_VISUAL_MODE || 'smoke';
if (!['smoke', 'reference', 'compare'].includes(mode)) throw new Error('IOS_VISUAL_MODE 应为 smoke、reference 或 compare。');
const selectedScenarios = selectScenarios(process.env.IOS_FILTER);
const udid = process.env.IOS_SIMULATOR_UDID || '';
if (!/^[A-Fa-f0-9-]{36}$/.test(udid)) throw new Error('必须指定专用模拟器 IOS_SIMULATOR_UDID。');
const information = readVerifiedBuild();
const app = await extractSimulator(information);
const devices = JSON.parse(execFileSync('xcrun', ['simctl', 'list', '-j', 'devices'], { encoding: 'utf8' }));
const runtime = Object.keys(devices.devices).find(key => devices.devices[key].some(device => device.udid === udid));
const simulator = devices.devices[runtime]?.find(device => device.udid === udid);
if (!simulator || !simulator.isAvailable) throw new Error(`找不到可用的指定模拟器：${udid}`);
if (simulator.state !== 'Booted') execFileSync('xcrun', ['simctl', 'boot', udid]);
execFileSync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'inherit', timeout: 180_000 });
execFileSync('xcrun', ['simctl', 'status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged',
  '--batteryLevel', '100', '--wifiBars', '3', '--cellularBars', '4']);
const results = resolve('ios/artifacts/results');
const profile = `${simulator.deviceTypeIdentifier}-${runtime}`.replace(/[^a-zA-Z0-9.-]/g, '_');
const snapshots = resolve('ios/snapshots', profile);
rmSync(results, { recursive: true, force: true });
mkdirSync(results, { recursive: true });
const report = { mode, profile, release: information.releaseTag, applicationCommit: information.applicationCommit, scenarios: [] };
writeFileSync(join(results, 'environment.json'), JSON.stringify({ profile, simulator, runtime, information }, null, 2));
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
  console.log('启动 XCUITest 会话（首次安装与 WDA 编译最多等待 10 分钟）');
  await driver.start({ platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid,
    'appium:app': app, 'appium:bundleId': applicationId, 'appium:noReset': false,
    'appium:language': 'en', 'appium:locale': 'en_US',
    'appium:autoAcceptAlerts': true, 'appium:wdaLaunchTimeout': 240_000,
    'appium:maxTypingFrequency': 8, 'appium:showXcodeLog': true, 'appium:isHeadless': true, 'appium:waitForIdleTimeout': 0,
    'appium:newCommandTimeout': 600 });
  console.log('XCUITest 已就绪，等待 Staging 确认页');
  await driver.find('staging-confirmation-input', 120_000);
  await driver.fill('staging-confirmation-input', 'CONFIRM');
  const confirmation = await driver.find('confirm-button');
  if (!await driver.request('GET', driver.path(`/element/${confirmation}/enabled`))) throw new Error('输入确认词后进入按钮仍禁用。');
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
      const animationDirectory = join(results, scenario.name);
      const frames = await recordAnimation(udid, animationDirectory);
      const files = [filename, ...frames.map(frame => `${scenario.name}/${frame}`)];
      const checks = [];
      for (const file of files) {
        const actual = join(results, file);
        const baseline = join(snapshots, file);
        if (mode === 'reference') {
          mkdirSync(join(snapshots, scenario.name), { recursive: true });
          cpSync(actual, baseline);
        } else if (mode === 'compare') {
          if (!existsSync(baseline)) throw new Error(`缺少已审查的视觉基准：${baseline}`);
          const comparison = comparePixels(readFileSync(baseline), readFileSync(actual));
          checks.push({ file, matches: comparison.matches, changedRatio: comparison.changedRatio });
          if (!comparison.matches && comparison.diff) writeFileSync(`${actual}.diff.png`, comparison.diff);
        }
      }
      if (mode === 'reference') {
        cpSync(join(animationDirectory, 'animation.mp4'), join(snapshots, scenario.name, 'animation.mp4'));
      }
      report.scenarios.push({ name: scenario.name, checks });
      if (checks.some(check => !check.matches)) throw new Error(`截图或动画帧发生变化：${scenario.name}，见报告及 diff PNG。`);
      console.log(`PASS ${scenario.name}`);
    } catch (error) {
      failures++;
      report.scenarios.push({ name: scenario.name, error: error.message });
      console.error(`FAIL ${scenario.name}: ${error.message}`);
      await driver.screenshot().then(bytes => writeFileSync(join(results, `${scenario.name}-failed.png`), bytes)).catch(() => {});
      await driver.source().then(xml => writeFileSync(join(results, `${scenario.name}-source.xml`), xml)).catch(() => {});
      break;
    }
  }
} catch (error) {
  report.setupError = error.message;
  await driver.screenshot().then(bytes => writeFileSync(join(results, 'setup-failed.png'), bytes)).catch(() => {});
  await driver.source().then(xml => writeFileSync(join(results, 'setup-source.xml'), xml)).catch(() => {});
  throw error;
} finally {
  writeFileSync(join(results, 'report.json'), JSON.stringify(report, null, 2));
  if (mode === 'reference' && existsSync(snapshots)) {
    writeFileSync(join(snapshots, 'provenance.json'), JSON.stringify(report, null, 2));
  }
  await driver.close().catch(error => console.error(`关闭会话失败：${error.message}`));
  server.kill('SIGTERM');
  execFileSync('xcrun', ['simctl', 'status_bar', udid, 'clear']);
}
if (failures) process.exitCode = 1;
