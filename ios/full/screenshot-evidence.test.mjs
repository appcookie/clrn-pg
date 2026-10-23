import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { guestScreenshotTests } from './guest-screenshot-contract.mjs';
import { baselineRelativePath } from './baseline-path.mjs';
import { exportScreenshotEvidence, validateScreenshotReport } from './screenshot-evidence.mjs';

const png = PNG.sync.write(new PNG({ width: 3, height: 4, fill: true }));
const build = { platform: 'ios', packageKind: 'simulator', applicationCommit: 'a'.repeat(40),
  package: { sha256: 'b'.repeat(64) } };
function fixture(locale = 'en', shard = 'startup') {
  const specs = guestScreenshotTests(locale, shard).map((row, index) => ({
    file: row.file, title: row.title, tests: [{ status: 'expected', expectedStatus: 'passed', results: [{
      status: 'passed', attachments: [
        ...row.images.map(name => ({ name: name.replace(/-(start|middle|end)\.png$/, '-$1'), contentType: 'image/png', body: png.toString('base64') })),
        ...[...(row.videos || []), ...(row.videoPrefixes || []).map(prefix => `${prefix}1-native-video`)]
          .map((name, i) => ({ name, contentType: 'video/mp4', path: `/runner/attachments/${index}-${i}.mp4` })),
        ...(row.json || []).map(name => ({ name, contentType: 'application/json',
          body: Buffer.from('{"reviewed":true}').toString('base64') })),
      ],
    }] }],
  }));
  return { stats: { expected: specs.length, unexpected: 0, skipped: 0, flaky: 0 }, suites: [{ specs }] };
}
const attachments = (report, title) => report.suites[0].specs.find(s => s.title.includes(title)).tests[0].results[0].attachments;
const searchTitle = 'guest search confirmation';
function artifact(directory, report) {
  mkdirSync(join(directory, 'full-results/attachments'), { recursive: true });
  mkdirSync(join(directory, 'release'), { recursive: true });
  writeFileSync(join(directory, 'full-results/report.json'), JSON.stringify(report));
  writeFileSync(join(directory, 'release/build-info.json'), JSON.stringify(build));
  for (const spec of report.suites[0].specs) {
    for (const a of spec.tests[0].results[0].attachments.filter(a => a.contentType === 'video/mp4')) {
      writeFileSync(join(directory, 'full-results/attachments', a.path.split('/').at(-1)),
        Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom0000')]));
    }
  }
}

test('三语言六分片必须提供77张原图，compare无后缀关键帧也参与验收', () => {
  let total = 0;
  for (const locale of ['en', 'zh-Hans', 'zh-Hant']) for (const shard of ['pages', 'startup']) {
    const results = validateScreenshotReport(fixture(locale, shard), locale, shard);
    total += results.flatMap(r => r.images).length;
  }
  assert.equal(total, 77);
  const report = fixture();
  const search = attachments(report, searchTitle);
  const image = search.find(a => a.name === 'search-confirmation-enter-middle');
  search.push({ ...image, name: `${image.name}.png` });
  assert.equal(validateScreenshotReport(report, 'en', 'startup').flatMap(r => r.images).length, 19);
});

test('全绿报告缺关键帧、损坏PNG、重复图片不一致或缺录屏仍失败', () => {
  const missing = fixture();
  const images = attachments(missing, searchTitle);
  images.splice(images.findIndex(a => a.name === 'search-confirmation-enter-middle'), 1);
  assert.throws(() => validateScreenshotReport(missing, 'en', 'startup'), /缺少本轮截图/);
  const broken = fixture();
  attachments(broken, searchTitle)[0].body = Buffer.from('not a PNG').toString('base64');
  assert.throws(() => validateScreenshotReport(broken, 'en', 'startup'));
  const duplicate = fixture();
  attachments(duplicate, searchTitle).push({ ...attachments(duplicate, searchTitle)[0],
    body: PNG.sync.write(new PNG({ width: 5, height: 4 })).toString('base64') });
  assert.throws(() => validateScreenshotReport(duplicate, 'en', 'startup'), /同名截图不一致/);
  const video = fixture();
  const list = attachments(video, searchTitle);
  list.splice(list.findIndex(a => a.contentType === 'video/mp4'), 1);
  assert.throws(() => validateScreenshotReport(video, 'en', 'startup'), /缺少本轮录屏/);
});

test('删用例并调低统计数、换用例、跳过或重试都不能冒充完整覆盖', () => {
  const removed = fixture();
  removed.suites[0].specs.pop(); removed.stats.expected--;
  assert.throws(() => validateScreenshotReport(removed, 'en', 'startup'), /数量/);
  const replaced = fixture();
  replaced.suites[0].specs[0].title = 'unrelated passing test';
  assert.throws(() => validateScreenshotReport(replaced, 'en', 'startup'), /缺少本轮通过的测试/);
  for (const status of ['skipped', 'failed']) {
    const report = fixture();
    report.suites[0].specs[0].tests[0].results[0].status = status;
    assert.throws(() => validateScreenshotReport(report, 'en', 'startup'), /缺少本轮通过的测试/);
  }
  const retried = fixture();
  retried.suites[0].specs[0].tests[0].results.push(retried.suites[0].specs[0].tests[0].results[0]);
  assert.throws(() => validateScreenshotReport(retried, 'en', 'startup'));
});

test('导出保留原始字节和构建来源，缺录屏文件时不生成成功产物', () => {
  const directory = mkdtempSync(join(tmpdir(), 'screenshot-evidence-'));
  try {
    const input = join(directory, 'input'), output = join(directory, 'output');
    artifact(input, fixture());
    const manifest = exportScreenshotEvidence(input, output, 'en', 'startup', { workflowHead: 'c'.repeat(40), run: '123' });
    assert.equal(manifest.screenshots, 19);
    assert.equal(manifest.source.run, '123');
    assert.equal(manifest.status, 'captured-not-reviewed');
    for (const file of manifest.files.filter(f => f.path.endsWith('.png'))) {
      assert.deepEqual(readFileSync(join(output, file.path)), png);
    }
    assert.match(readFileSync(join(output, 'index.html'), 'utf8'), /search-confirmation-enter-middle/);
    rmSync(join(input, 'full-results/attachments'), { recursive: true });
    assert.throws(() => exportScreenshotEvidence(input, join(directory, 'missing'), 'en', 'startup'), /录屏附件文件缺失/);
    assert.equal(existsSync(join(directory, 'missing')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('同时删除PNG和review条目也必须在基准预检失败', () => {
  const directory = mkdtempSync(join(tmpdir(), 'screenshot-preflight-'));
  try {
    const destination = join(directory, 'ios/snapshots/v1');
    cpSync('ios/snapshots/v1', destination, { recursive: true });
    const env = { ...process.env, IOS_CI_MATRIX: JSON.stringify({ include: [
      { group: 'guest', locale: 'en', shard: 'startup' },
    ] }) };
    const run = () => spawnSync(process.execPath, [resolve('ios/full/baseline-preflight.mjs')],
      { cwd: directory, env, encoding: 'utf8' });
    assert.equal(run().status, 0);
    const path = baselineRelativePath('search-confirmation-enter-middle.png', 'en');
    rmSync(join(destination, path));
    const review = JSON.parse(readFileSync(join(destination, 'review.json'), 'utf8'));
    review.files = review.files.filter(f => f.path !== path);
    writeFileSync(join(destination, 'review.json'), JSON.stringify(review));
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /游客验收清单缺少基准/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('候选导出兼容Actions真实根目录、历史嵌套目录和compare无后缀关键帧', () => {
  const directory = mkdtempSync(join(tmpdir(), 'candidate-export-'));
  try {
    for (const nested of [false, true]) {
      const input = join(directory, `ios-guest-en-startup-${nested}`);
      const report = fixture();
      report.suites[0].specs[0].tests[0].results[0].attachments.push({
        name: 'texas-holdem-personal-leaderboard-exit-pre-warmup-start',
        contentType: 'image/png', body: png.toString('base64'),
      });
      artifact(nested ? join(input, 'artifacts') : input, report);
      const output = join(directory, `output-${nested}`);
      const result = spawnSync(process.execPath, ['ios/full/export-candidates.mjs', output, input], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const manifest = JSON.parse(readFileSync(join(output, 'candidate-manifest.json'), 'utf8'));
      assert.equal(manifest.files.length, 19);
      assert.deepEqual(readFileSync(join(output, 'v1', baselineRelativePath('search-confirmation-enter-middle.png', 'en'))), png);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
