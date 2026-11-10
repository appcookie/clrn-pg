import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { bundleIosMatrix, groupKey } from './ios-ci-plan.mjs';
import { iosAccountMatrix, ciAccounts } from './ci-accounts.mjs';
import { executeIosGroups, assertGroupsPassed } from './ios-ci-groups.mjs';
import { groupEnvironment, fullTestArgs, validateCompletedReport } from './ios-ci-native.mjs';
import { verifyBusinessResults } from './verify-ios-business.mjs';
import { runCiCommand } from './ios-ci-command.mjs';
import { jobTiming } from './ios-ci-timing.mjs';

const withoutAccount = entry => { const { account, ...rest } = entry; return rest; };
const groups = [{ label: 'first', group: 'guest' }, { label: 'second', group: 'texas' }];

function fixture(overrides = {}) {
  const events = [], saved = [];
  const hooks = { cancelled: () => false, save: async results => saved.push(structuredClone(results)) };
  for (const phase of ['prepare', 'test', 'validate', 'cleanup', 'archive']) {
    hooks[phase] = async group => {
      events.push(`${group.label}/${phase}`);
      await overrides[phase]?.(group);
    };
  }
  return { hooks, events, saved };
}

test('自动覆盖原有26分组加Staging，恰好分配到三个Mac，分组参数不变', () => {
  const matrix = iosAccountMatrix('123', 'pr', 'all', ciAccounts);
  assert.equal(matrix.include.length, 26);
  const bundled = bundleIosMatrix(matrix, '123', ciAccounts, true);
  assert.deepEqual(bundled.include.map(item => item.business), ['app', 'texas', 'pinsanzhang']);
  const actual = bundled.include.flatMap(item => item.groups);
  const byKey = entries => entries.map(withoutAccount).sort((a, b) => groupKey(a).localeCompare(groupKey(b)));
  assert.deepEqual(byKey(actual.filter(entry => entry.group !== 'staging')), byKey(matrix.include));
  assert.equal(actual.length, 27);
  assert.equal(new Set(actual.map(groupKey)).size, 27);
  assert.equal(bundled.include[0].groups.at(-1).group, 'staging');
  assert.ok(bundled.include.every(item => item.timeout < 360));
  assert.equal(bundled.include[0].timeout, 330);
});

test('每个业务全程持有一个账号，少量账号共享锁，跨运行碰撞仍使用相同锁键', () => {
  for (const pool of [ciAccounts, ciAccounts.slice(0, 3), ciAccounts.slice(0, 1)]) {
    const original = iosAccountMatrix('123', 'pr', 'all', pool);
    const matrix = bundleIosMatrix(original, '123', pool, true);
    for (const job of matrix.include) {
      assert.ok(pool.includes(job.account));
      assert.ok(job.groups.every(group => !group.account || group.account === job.account));
    }
    const next = bundleIosMatrix(iosAccountMatrix('124', 'pr', 'all', pool), '124', pool);
    assert.equal(matrix.include[1].account, next.include[0].account);
    if (pool.length === 1) assert.equal(new Set(matrix.include.map(item => item.account)).size, 1);
    else assert.equal(new Set(matrix.include.map(item => item.account)).size, 3);
  }
  const workflow = readFileSync(new URL('../.github/workflows/ios-full.yml', import.meta.url), 'utf8');
  assert.match(workflow, /group: ios-account-\$\{\{ matrix.account \|\|/);
  assert.match(workflow, /queue: max/);
});

test('手动业务、语言及功能分片保持原计划，游客不需要Secret，空诊断不分配Mac', () => {
  for (const selected of ['all', 'guest', 'functional', 'texas', 'zhajinhua', 'quarantined', 'animations']) {
    const original = iosAccountMatrix('123', selected, 'en', ciAccounts);
    const bundled = bundleIosMatrix(original, '123', ciAccounts);
    const actual = bundled.include.flatMap(item => item.groups).map(withoutAccount);
    assert.deepEqual(new Set(actual.map(JSON.stringify)), new Set(original.include.map(withoutAccount).map(JSON.stringify)));
  }
  const guest = bundleIosMatrix(iosAccountMatrix('123', 'guest', 'zh-Hant'), '123', []);
  assert.equal(guest.include.length, 1);
  assert.equal(guest.include[0].account, '');
  assert.equal(guest.include[0].groups.length, 2);
  assert.deepEqual(bundleIosMatrix({ include: [] }, '123', [], false), { include: [] });
});

test('每个阶段失败后仍清理、保留证据并执行下一组，最终不能被后续成功掩盖', async () => {
  for (const phase of ['prepare', 'test', 'validate', 'cleanup', 'archive']) {
    const { hooks, events, saved } = fixture({ [phase]: group => {
      if (group.label === 'first') throw new Error('injected failure');
    } });
    const results = await executeIosGroups(groups, hooks);
    assert.deepEqual(results.map(result => result.status), ['failed', 'passed']);
    assert.ok(events.includes('first/cleanup'));
    assert.ok(events.includes('first/archive'));
    assert.ok(events.includes('second/test'));
    assert.equal(saved[0][0].status, 'pending');
    assert.equal(saved[1][0].status, 'running');
    assert.throws(() => assertGroupsPassed(groups, results));
    assert.equal(results[0].errors[0].phase, phase);
  }
});

test('取消、意外跳过、未完成、缺失或错组都不能通过', async () => {
  let cancelled = false;
  const { hooks, events } = fixture({ test: () => { cancelled = true; } });
  hooks.cancelled = () => cancelled;
  const results = await executeIosGroups(groups, hooks);
  assert.deepEqual(results.map(result => result.status), ['cancelled', 'cancelled']);
  assert.ok(events.includes('first/cleanup'));
  assert.ok(!events.includes('second/test'));
  for (const status of ['cancelled', 'skipped', 'pending', 'running', 'failed']) {
    assert.throws(() => assertGroupsPassed(groups, groups.map(group => ({ group, status }))));
  }
  assert.throws(() => assertGroupsPassed(groups, []));
  assert.throws(() => assertGroupsPassed(groups, [...groups].reverse().map(group => ({ group, status: 'passed' }))));
  const passing = await executeIosGroups(groups, fixture().hooks);
  assert.doesNotThrow(() => assertGroupsPassed(groups, passing));
});

test('总门禁核对每个业务和分组身份及运行来源，拒绝前轮结果、漏组与重复结果', () => {
  const matrix = bundleIosMatrix(iosAccountMatrix('123', 'pr', 'all', ciAccounts), '123', ciAccounts, true);
  const reports = matrix.include.map(plan => ({ plan, run: '123', attempt: '2',
    results: plan.groups.map(group => ({ group, status: 'passed' })) }));
  assert.doesNotThrow(() => verifyBusinessResults(matrix, reports, '123', '2'));
  assert.throws(() => verifyBusinessResults(matrix, reports, '124', '2'));
  assert.throws(() => verifyBusinessResults(matrix, reports, '123', '1'));
  assert.doesNotThrow(() => verifyBusinessResults(matrix, reports, '123', '3'));
  assert.throws(() => verifyBusinessResults(matrix, reports.slice(1), '123', '2'));
  assert.throws(() => verifyBusinessResults(matrix, [reports[0], reports[0], reports[2]], '123', '2'));
  const missing = structuredClone(reports);
  missing[0].results.pop();
  assert.throws(() => verifyBusinessResults(matrix, missing, '123', '2'));
});

test('分组进程显式切换语言、模式、账号，游客和Staging不会继承登录凭据', () => {
  const base = { CLRN_IOS_CI_TEST_ACCOUNTS: 'secret-pool', IOS_VISUAL_MODE: 'compare', VISUAL_USERNAME: 'old-user', VISUAL_PASSWORD: 'old-secret',
    E2E_TEST_USERNAME: 'old-user', E2E_TEST_PASSWORD: 'old-secret',
    E2E_CREATION_STORAGE_STATE_FILE: 'old-state', IOS_ANIMATION_RECORD_ONLY: '1' };
  const guest = groupEnvironment({ group: 'guest', locale: 'zh-Hant', filter: 'pages', account: '' }, base);
  assert.equal(guest.IOS_LOCALE, 'zh-Hant');
  assert.equal(guest.VISUAL_PASSWORD, undefined);
  assert.equal(guest.CLRN_IOS_CI_TEST_ACCOUNTS, undefined);
  assert.equal(guest.E2E_TEST_USERNAME, undefined);
  assert.equal(guest.E2E_CREATION_STORAGE_STATE_FILE, undefined);
  assert.equal(guest.IOS_ANIMATION_RECORD_ONLY, '0');
  const staging = groupEnvironment({ group: 'staging', locale: 'en', mode: 'smoke', account: '', filter: '' }, base);
  assert.equal(staging.IOS_VISUAL_MODE, 'smoke');
  assert.equal(staging.VISUAL_USERNAME, undefined);
  const animation = groupEnvironment({ group: 'zhajinhua', locale: 'en', account: ciAccounts[0],
    recordOnly: true, animation: 'animation-20', animationPart: 'themes', mode: 'reference' }, base);
  assert.equal(animation.ANIMATION_PART, 'themes');
  assert.equal(animation.IOS_VISUAL_MODE, 'reference');
  assert.equal(animation.IOS_ANIMATION_RECORD_ONLY, '1');
  assert.deepEqual(fullTestArgs({ filter: 'CLUB-007/1$', playwrightShard: '2/5' }),
    ['run', 'test:ios:full', '--', '--grep', 'CLUB-007/1$', '--shard', '2/5', '--fully-parallel', '--workers', '1']);
});

test('即便测试进程退出0，空报告、skip和未执行结果仍阻断', () => {
  const report = { suites: [{ specs: [{ tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] }] }] }] };
  assert.doesNotThrow(() => validateCompletedReport(report));
  assert.throws(() => validateCompletedReport({ suites: [] }));
  for (const status of ['skipped', 'interrupted', 'failed', 'timedOut']) {
    const broken = structuredClone(report);
    broken.suites[0].specs[0].tests[0].results[0].status = status;
    assert.throws(() => validateCompletedReport(broken));
  }
  assert.throws(() => validateCompletedReport({ ...report, errors: [{ message: 'worker failed' }] }));
});

test('真实子进程失败与取消会传播，并清除留存后代进程', async () => {
  await assert.rejects(runCiCommand(process.execPath, ['-e', 'process.exit(7)'], process.env), /7/);
  await assert.rejects(runCiCommand('/nonexistent/clrn-command', [], process.env));
  const controller = new AbortController();
  const promise = runCiCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.env, controller.signal);
  controller.abort();
  await assert.rejects(promise);
  const directory = mkdtempSync(join(tmpdir(), 'ios-ci-process-'));
  try {
    const marker = join(directory, 'leaked');
    const child = join(directory, 'child.mjs');
    writeFileSync(child, `import { writeFileSync } from 'node:fs'; setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'leaked'), 500);`);
    const parent = `const { spawn } = require('node:child_process'); spawn(process.execPath, [process.argv[1]], {stdio:'ignore'}).unref(); setTimeout(() => process.exit(0), 100);`;
    await runCiCommand(process.execPath, ['-e', parent, child], process.env);
    await delay(700);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('耗时按GitHub job的创建、开始、测试步骤和完成时间分解', () => {
  const at = seconds => new Date(Date.UTC(2026, 10, 10, 0, 0, seconds)).toISOString();
  const result = jobTiming({ name: 'App', created_at: at(0), started_at: at(20), completed_at: at(120), conclusion: 'success',
    steps: [{ name: '顺序执行全部逻辑分组，失败后清理并继续', started_at: at(30), completed_at: at(110) }] });
  assert.deepEqual(result, { name: 'App', wait: 20, setup: 10, test: 80, total: 100, conclusion: 'success' });
});

test('Staging保留全部六个独立场景，遗漏或失败不能视为覆盖等价', async () => {
  const { validateStagingReport } = await import('./ios-ci-native.mjs');
  const { scenarios } = await import('../ios/scenarios.mjs');
  const report = { scenarios: scenarios.map(({ name }) => ({ name, checks: [] })) };
  assert.doesNotThrow(() => validateStagingReport(report, ''));
  assert.throws(() => validateStagingReport({ scenarios: report.scenarios.slice(1) }, ''));
  assert.throws(() => validateStagingReport({ ...report, setupError: 'failed' }, ''));
  const failed = structuredClone(report);
  failed.scenarios[0].checks.push({ matches: false });
  assert.throws(() => validateStagingReport(failed, ''));
});

test('两组复用固定输出目录不会覆盖历史证据，导出失败也保存原报告和候选', async () => {
  const { archiveGroupArtifacts } = await import('./ios-ci-native.mjs');
  const { mkdirSync } = await import('node:fs');
  const directory = mkdtempSync(join(tmpdir(), 'ios-ci-evidence-'));
  const artifactRoot = join(directory, 'artifacts');
  const root = join(directory, 'business');
  const snapshots = join(directory, 'snapshots');
  const env = { IOS_VISUAL_MODE: 'reference', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' };
  try {
    mkdirSync(join(artifactRoot, 'full-results'), { recursive: true });
    mkdirSync(join(artifactRoot, 'release'), { recursive: true });
    mkdirSync(snapshots);
    writeFileSync(join(artifactRoot, 'release/build-info.json'), 'build-identity');
    writeFileSync(join(snapshots, 'candidate.png'), 'candidate');
    const first = { group: 'guest', locale: 'en', shard: 'pages' };
    const second = { group: 'guest', locale: 'zh-Hant', shard: 'pages' };
    writeFileSync(join(artifactRoot, 'full-results/report.json'), 'first report');
    await archiveGroupArtifacts(first, { root, env, artifactRoot, snapshots, exportVideo: async () => {} });
    writeFileSync(join(artifactRoot, 'full-results/report.json'), 'second failed report');
    await assert.rejects(archiveGroupArtifacts(second, { root, env, artifactRoot, snapshots,
      exportVideo: async () => { throw new Error('broken video'); } }));
    assert.equal(readFileSync(join(root, groupKey(first), 'full-results/report.json'), 'utf8'), 'first report');
    assert.equal(readFileSync(join(root, groupKey(second), 'full-results/report.json'), 'utf8'), 'second failed report');
    assert.equal(readFileSync(join(root, groupKey(second), 'reference-candidates/candidate.png'), 'utf8'), 'candidate');
    assert.equal(readFileSync(join(root, groupKey(second), 'release/build-info.json'), 'utf8'), 'build-identity');
    assert.equal(JSON.parse(readFileSync(join(root, groupKey(second), 'group.json'), 'utf8')).attempt, '2');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('自动工作流仅一个Mac矩阵入口，Staging不再自动申请Mac，旧检查名仍保留', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ios-full.yml', import.meta.url), 'utf8');
  const staging = readFileSync(new URL('../.github/workflows/ios-simulator.yml', import.meta.url), 'utf8');
  assert.equal((workflow.match(/runs-on: macos-15/g) || []).length, 1);
  assert.match(workflow, /max-parallel: 3/);
  assert.doesNotMatch(staging, /  (pull_request|push):/);
  assert.match(staging, /  workflow_dispatch:/);
  assert.match(workflow, /\n  proxy-check:\n/);
  assert.match(workflow, /'iOS diagnostic checks' \|\| 'check'/);
  assert.match(workflow, /'iOS Staging diagnostics' \|\| 'simulator'/);
  assert.match(workflow, /IOS_INCLUDE_STAGING: \$\{\{ github.event_name != 'workflow_dispatch' \}\}/);
  assert.match(workflow, /run: node scripts\/verify-ios-business.mjs/);
  assert.equal((workflow.match(/npx appium driver install/g) || []).length, 1);
});

test('打包CLI保留原计划、仅输出公开账号，单游客手动计划只申请App', async () => {
  const { spawnSync } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'ios-ci-bundle-'));
  try {
    const output = join(directory, 'output');
    const password = 'fake-bundle-password';
    const env = { ...process.env, GITHUB_RUN_ID: '123', GITHUB_OUTPUT: output, IOS_INCLUDE_STAGING: 'true',
      CLRN_IOS_CI_TEST_ACCOUNTS: JSON.stringify({ accounts: [{ username: ciAccounts[0], password, status: 'ready' }] }),
      IOS_CI_MATRIX: JSON.stringify(iosAccountMatrix('123', 'pr', 'all', ciAccounts.slice(0, 1))) };
    const result = spawnSync(process.execPath, ['scripts/ios-ci-plan.mjs'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const text = readFileSync(output, 'utf8');
    assert.ok(![text, result.stdout, result.stderr].some(value => value.includes(password)));
    assert.equal(JSON.parse(text.split('\n')[0].slice(7)).include.length, 3);
    writeFileSync(output, '');
    const guest = spawnSync(process.execPath, ['scripts/ios-ci-plan.mjs'], { encoding: 'utf8', env: { ...env,
      IOS_INCLUDE_STAGING: 'false', CLRN_IOS_CI_TEST_ACCOUNTS: '', IOS_CI_MATRIX: JSON.stringify(iosAccountMatrix('123', 'guest', 'en')) } });
    assert.equal(guest.status, 0, guest.stderr);
    assert.equal(JSON.parse(readFileSync(output, 'utf8').split('\n')[0].slice(7)).include.length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
