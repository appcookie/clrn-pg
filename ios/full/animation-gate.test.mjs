import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { animationCases, validateAnimationReport } from './animation-gate.mjs';
import { iosAccountMatrix, ciAccounts } from '../../scripts/ci-accounts.mjs';
import { collectPlaywright } from '../../scripts/playwright-collection.mjs';
import { reportSpecs, screenshotTestKey } from './guest-screenshot-contract.mjs';

test('PR 实际调度全部 21 项 Web 动画及其完整原生分片，不能只做标题登记', () => {
  const source = JSON.parse(readFileSync('docs/web-coverage-source.json', 'utf8'));
  const matrix = iosAccountMatrix('123', 'pr', 'all', ciAccounts).include;
  const jobs = matrix.filter(entry => entry.animation);
  assert.equal(source.animations.length, 21);
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
  const all = JSON.parse(collectPlaywright(['--config', 'ios/full/playwright.config.ts', '--list', '--reporter=json'],
    { cwd: process.cwd(), env: { ...process.env, IOS_GROUP: 'all', IOS_LOCALE: 'en' } }));
  const specs = [...reportSpecs(all)];
  for (const job of iosAccountMatrix('123', 'animations', 'en', ciAccounts).include) {
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
