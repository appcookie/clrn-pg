import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { animationCases, validateAnimationReport } from './animation-gate.mjs';
import { iosAccountMatrix, ciAccounts } from '../../scripts/ci-accounts.mjs';
import { collectPlaywright } from '../../scripts/playwright-collection.mjs';
import { reportSpecs, screenshotTestKey } from './guest-screenshot-contract.mjs';

test('PR 实际调度全部 21 项 Web 动画及其完整原生分片，不能只做标题登记', () => {
  const source = JSON.parse(readFileSync('docs/web-coverage-source.json', 'utf8'));
  const matrix = iosAccountMatrix('123', 'pr', 'all', ciAccounts).include;
  const jobs = matrix.filter(entry => entry.animation);
  assert.equal(source.animations.length, 21);
  assert.equal(animationCases.length, 25);
  assert.equal(jobs.length, animationCases.length);
  assert.ok(jobs.every(entry => entry.recordOnly === true), 'PR 中全部 25 组只采集录屏');
  assert.ok(iosAccountMatrix('123', 'animations', 'en', ciAccounts).include.every(entry => !entry.recordOnly),
    '手动诊断保留完整动画断言');
  assert.equal(new Set(jobs.map(entry => entry.animation)).size, jobs.length);
  for (const row of source.animations) {
    const entry = animationCases.find(item => item.file === row.nativeImplementation.file.replace('ios/full/', '')
      && item.title === row.nativeImplementation.testTitle);
    assert.ok(entry, row.title);
    assert.ok(jobs.some(item => item.animation === entry.id));
  }
  assert.equal(matrix.filter(entry => !entry.animation).length, 6);
  assert.ok(jobs.every(entry => entry.locale === 'en'));
  assert.throws(() => iosAccountMatrix('123', 'pr'), /独立 iOS 账号/);
});

test('PR 录屏模式只校验真实 MP4，不要求动画关键帧截图', () => {
  const entry = animationCases[0];
  const report = { stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ specs: [{ file: entry.file, title: entry.title, tests: [{
      expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', attachments: [
        { name: 'recorded-native-video', contentType: 'video/mp4', path: '/tmp/recorded.mp4' },
      ] }],
    }] }] }] };
  assert.deepEqual(validateAnimationReport(report, entry.id, 'record-only').images, []);
  report.suites[0].specs[0].tests[0].results[0].attachments = [];
  assert.throws(() => validateAnimationReport(report, entry.id, 'record-only'), /录屏/);
});

test('动画矩阵每片选中唯一指定的真实测试，无跳过或错误的业务组', { timeout: 180_000 }, () => {
  const byGroup = new Map();
  for (const job of iosAccountMatrix('123', 'animations', 'en', ciAccounts).include) {
    if (!byGroup.has(job.group)) {
      const report = JSON.parse(collectPlaywright(['--config', 'ios/full/playwright.config.ts', '--list', '--reporter=json'],
        { cwd: process.cwd(), env: { ...process.env, IOS_GROUP: job.group, IOS_LOCALE: 'en' } }));
      byGroup.set(job.group, [...reportSpecs(report)]);
    }
    const specs = byGroup.get(job.group);
    const entry = animationCases.find(item => item.id === job.animation);
    const matched = specs.filter(spec => new RegExp(job.filter).test(spec.title));
    assert.equal(matched.length, 1, entry.title);
    assert.equal(screenshotTestKey(matched[0]), screenshotTestKey(entry));
    assert.equal(matched[0].tests[0].expectedStatus, 'passed');
  }
  const all = JSON.parse(collectPlaywright(['--config', 'ios/full/playwright.config.ts', '--list', '--reporter=json'],
    { cwd: process.cwd(), env: { ...process.env, IOS_GROUP: 'all', IOS_LOCALE: 'en' } }));
  const dedicated = new Set(['tests/animation-transitions.spec.ts', 'tests/web-animation-parity.spec.ts',
    'tests/slot-animation.spec.ts', 'tests/club-skeleton-animation.spec.ts']);
  for (const spec of reportSpecs(all)) {
    if (dedicated.has(spec.file)) {
      assert.ok(animationCases.some(entry => screenshotTestKey(entry) === screenshotTestKey(spec)),
        `原生独立动画用例漏出 CI 门禁：${spec.title}`);
    }
  }
});

test('动画验收拒绝只收集未执行、跳过、失败、重试和缺图的报告', () => {
  const entry = animationCases[0];
  const report = { stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ specs: [{ file: entry.file, title: entry.title, tests: [{
      expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', attachments: [] }],
    }] }] }] };
  assert.throws(() => validateAnimationReport(report, entry.id), /截图清单|截图/);
  for (const change of [
    r => r.suites[0].specs[0].tests[0].results = [],
    r => r.suites[0].specs[0].tests[0].results.push(r.suites[0].specs[0].tests[0].results[0]),
    r => r.stats.skipped++,
    r => r.stats.flaky++,
    r => r.suites[0].specs[0].tests[0].results[0].status = 'failed',
    r => r.suites[0].specs[0].title = 'unrelated passing test',
  ]) {
    const copy = structuredClone(report); change(copy);
    assert.throws(() => validateAnimationReport(copy, entry.id, 'reference'));
  }
  assert.throws(() => validateAnimationReport(report, 'unknown'));
});

test('动画 CI 验收必须读取本轮录像文件，不能仅凭报告中的附件名称通过', () => {
  const directory = mkdtempSync(join(tmpdir(), 'animation-gate-'));
  const entry = animationCases[0];
  const movie = join(directory, 'capture.mp4'), file = join(directory, 'report.json');
  const png = PNG.sync.write(new PNG({ width: 1, height: 1 })).toString('base64');
  const attachments = [...entry.images.map(name => ({ name, contentType: 'image/png', body: png })),
    { name: 'actual-native-video', contentType: 'video/mp4', path: movie }];
  const report = { stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ specs: [{ file: entry.file, title: entry.title, tests: [{
      expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', attachments }],
    }] }] }] };
  const run = () => spawnSync(process.execPath, [resolve('ios/full/animation-gate.mjs'), file, entry.id],
    { encoding: 'utf8', env: { ...process.env, IOS_VISUAL_MODE: 'compare' } });
  try {
    writeFileSync(file, JSON.stringify(report));
    assert.notEqual(run().status, 0, '报告有附件但视频丢失必须失败');
    writeFileSync(movie, 'invalid-video');
    assert.notEqual(run().status, 0, '损坏视频必须失败');
    const header = Buffer.alloc(12); header.write('ftyp', 4);
    writeFileSync(movie, header);
    assert.equal(run().status, 0);
    attachments.at(-1).path = join(tmpdir(), 'another-run.mp4');
    writeFileSync(file, JSON.stringify(report));
    assert.match(run().stderr, /本轮结果目录/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('首次采集清单为空时仍必须输出有效候选 PNG，且不能自动批准清单', () => {
  const entry = animationCases[0], reviewedImages = entry.images;
  const attachments = [{ name: 'native-video', contentType: 'video/mp4', path: '/tmp/capture.mp4' }];
  const report = { stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ specs: [{ file: entry.file, title: entry.title, tests: [{
      expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', attachments }],
    }] }] }] };
  entry.images = [];
  try {
    assert.throws(() => validateAnimationReport(report, entry.id, 'reference'), /候选 PNG/);
    const image = { name: 'new-phase.png', contentType: 'image/png', body: 'invalid' };
    attachments.push(image);
    assert.throws(() => validateAnimationReport(report, entry.id, 'reference'));
    image.body = PNG.sync.write(new PNG({ width: 3, height: 7 })).toString('base64');
    assert.deepEqual(validateAnimationReport(report, entry.id, 'reference').images, ['new-phase.png']);
    assert.deepEqual(entry.images, [], '发现候选不能变成已审查基准');
    assert.throws(() => validateAnimationReport(report, entry.id, 'compare'), /完整审查/);
    assert.throws(() => validateAnimationReport(report, entry.id, 'typo'), /未知动画验收模式/);
    image.name = 'raw-video-frame-0';
    assert.throws(() => validateAnimationReport(report, entry.id, 'reference'), /候选 PNG/);
  } finally { entry.images = reviewedImages; }
});
