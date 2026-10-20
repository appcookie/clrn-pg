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
  assert.equal(animationCases.length, 23);
  assert.equal(jobs.length, animationCases.length);
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
