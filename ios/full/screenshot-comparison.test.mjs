import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { maskScreenshot } from './screenshot.ts';

// 基准路径在模块加载时固定；将合成基准隔离到本测试创建的目录，绝不触碰仓库 PNG。
const directory = mkdtempSync(join(tmpdir(), 'clrn-screenshot-comparison-'));
const workingDirectory = process.cwd();
let compareScreenshot, baselinePath;
try {
  process.chdir(directory);
  ({ compareScreenshot } = await import('./device.ts'));
  ({ baselinePath } = await import('./baseline-path.mjs'));
} finally {
  process.chdir(workingDirectory);
}
after(() => rmSync(directory, { recursive: true, force: true }));

function picture(width = 100, height = 100, changed) {
  const image = new PNG({ width, height });
  image.data.fill(255);
  if (changed) for (let y = changed.y; y < changed.y + changed.height; y++)
    for (let x = changed.x; x < changed.x + changed.width; x++) image.data[(y * width + x) * 4] = 0;
  return PNG.sync.write(image);
}

function setup(t, bytes, baseline = picture()) {
  const previous = { mode: process.env.IOS_VISUAL_MODE, locale: process.env.IOS_LOCALE };
  process.env.IOS_VISUAL_MODE = 'compare';
  process.env.IOS_LOCALE = 'en';
  t.after(() => {
    for (const [key, value] of [['IOS_VISUAL_MODE', previous.mode], ['IOS_LOCALE', previous.locale]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const name = 'en-hall';
  const path = baselinePath(`${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  if (baseline) writeFileSync(path, baseline);
  const attachments = new Map();
  const info = { attach: async (name, options) => attachments.set(name, options.body) };
  let nativeCaptures = 0;
  const device = { screenSize: { width: 1178, height: 2556 }, screenshot: async () => bytes,
    nativeScreenshot: async () => { nativeCaptures++; return baseline; } };
  return { name, path, info, device, attachments, nativeCaptures: () => nativeCaptures };
}

test('稳定的 XCTest 错图仍失败，不能换用恰好匹配的 Simulator 图或排除 Dynamic Island', async t => {
  const baseline = picture(1178, 2556);
  const actual = picture(1178, 2556, { x: 400, y: 32, width: 379, height: 114 });
  const fixture = setup(t, actual, baseline);
  await assert.rejects(compareScreenshot(fixture.device, fixture.name, fixture.info, {
    transientState: async () => {},
  }), /变化比例/);
  assert.equal(fixture.nativeCaptures(), 0);
  assert.deepEqual(fixture.attachments.get('en-hall.png'), actual);
  assert.ok(fixture.attachments.has('en-hall.png-diff'));
  assert.ok(!fixture.attachments.has('en-hall.png-exclusions'));
  assert.deepEqual(readFileSync(fixture.path), baseline);
});

test('固定自定义来源不会调用默认来源；最小遮罩外的缺陷仍失败并保留原图', async t => {
  const masks = [{ x: 0, y: 0, width: 10, height: 10, reason: '合成动态区域' }];
  const baseline = maskScreenshot(picture(), masks);
  const fixture = setup(t, picture(), baseline);
  fixture.device.screenshot = async () => { throw new Error('不应换用默认来源'); };
  const options = { masks, transientState: async () => {}, takeScreenshot: async () =>
    picture(100, 100, { x: 0, y: 0, width: 10, height: 10 }) };
  await compareScreenshot(fixture.device, fixture.name, fixture.info, options);
  const actual = picture(100, 100, { x: 10, y: 0, width: 10, height: 10 });
  await assert.rejects(compareScreenshot(fixture.device, fixture.name, fixture.info, {
    ...options, takeScreenshot: async () => actual,
  }), /变化比例/);
  assert.deepEqual(fixture.attachments.get('en-hall-original'), actual);
  assert.deepEqual(readFileSync(fixture.path), baseline);
});

test('固定排除区有报告证据，区外缺陷按原有效面积失败', async t => {
  const inside = picture(100, 100, { x: 0, y: 0, width: 10, height: 10 });
  const fixture = setup(t, inside);
  const comparisonExclusions = [{ x: 0, y: 0, width: 10, height: 10 }];
  const options = { comparisonExclusions, transientState: async () => {} };
  await compareScreenshot(fixture.device, fixture.name, fixture.info, options);
  assert.deepEqual(JSON.parse(fixture.attachments.get('en-hall.png-exclusions')), comparisonExclusions);
  fixture.device.screenshot = async () => picture(100, 100, { x: 20, y: 0, width: 5, height: 10 });
  await assert.rejects(compareScreenshot(fixture.device, fixture.name, fixture.info, options), /变化比例/);
  assert.deepEqual(comparisonExclusions, [{ x: 0, y: 0, width: 10, height: 10 }]);
});

test('缺少当前基准、尺寸不同或没有有效像素均失败，存在备用命名图片也不能接受', async t => {
  const fixture = setup(t, picture(), null);
  const alternate = baselinePath('en-hall-alternate.png');
  mkdirSync(dirname(alternate), { recursive: true });
  writeFileSync(alternate, picture());
  const options = { transientState: async () => {} };
  await assert.rejects(compareScreenshot(fixture.device, fixture.name, fixture.info, options), /缺少已审查基准/);
  writeFileSync(fixture.path, picture(101, 100));
  await assert.rejects(compareScreenshot(fixture.device, fixture.name, fixture.info, options), /变化比例 1/);
  writeFileSync(fixture.path, picture());
  // 页面稳定性本身也必须拒绝全部排除；无需等待其30秒就绪窗口，直接检验最终比较入口。
  const { assertVisual } = await import('./device.ts');
  await assert.rejects(assertVisual(picture(), fixture.name, fixture.info,
    [{ x: 0, y: 0, width: 100, height: 100 }]), /变化比例 1/);
  assert.equal(fixture.nativeCaptures(), 0);
});

test('reference 保存本轮真实画面，即使新旧差异在容差内也不恢复旧图；之后 compare 不改基准', async t => {
  const actual = picture(100, 100, { x: 20, y: 20, width: 1, height: 1 });
  const fixture = setup(t, actual);
  // 仅供算法测试的合成构建身份，不是模拟器执行或视觉批准证据。
  const { artifactDirectory, deployment, simulatorPackageName, applicationId } = await import('../release.mjs');
  const record = deployment();
  const release = { tag_name: record.release_tag, published_at: '2026-10-29T00:00:00Z',
    body: '<!-- laiwan-ios-package schema=1 -->', assets: ['build-info.json', simulatorPackageName]
      .map(name => ({ name, state: 'uploaded', size: 1 })) };
  const [, buildNumber, buildAttempt] = /^ios-staging-(\d+)-(\d+)-/.exec(record.release_tag);
  const build = { schemaVersion: 2, packageKind: 'simulator', platform: 'ios', environment: 'staging',
    applicationId, applicationCommit: record.sha, releaseTag: record.release_tag,
    buildNumber: Number(buildNumber), buildAttempt: Number(buildAttempt),
    package: { name: simulatorPackageName, size: 1, sha256: '1'.repeat(64) } };
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(join(artifactDirectory, 'release.json'), JSON.stringify(release));
  writeFileSync(join(artifactDirectory, 'build-info.json'), JSON.stringify(build));
  process.env.IOS_VISUAL_MODE = 'reference';
  await compareScreenshot(fixture.device, fixture.name, fixture.info, { transientState: async () => {} });
  assert.deepEqual(readFileSync(fixture.path), actual);
  process.env.IOS_VISUAL_MODE = 'compare';
  await compareScreenshot(fixture.device, fixture.name, fixture.info, { transientState: async () => {} });
  assert.deepEqual(readFileSync(fixture.path), actual);
});
