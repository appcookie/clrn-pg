// This adapter owns only the disposable hosted runner's simulator and processes.
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { selectScenarios } from '../ios/scenarios.mjs';
import { applicationId } from '../ios/release.mjs';
import { restoreSystemProxy, assertHostedRunner } from '../ios/full/system-proxy.mjs';
import { reportSpecs } from '../ios/full/guest-screenshot-contract.mjs';
import { renderJobFailure } from '../ios/full/ci-failure-summary.mjs';
import { groupKey } from './ios-ci-plan.mjs';
import { runCiCommand } from './ios-ci-command.mjs';

const workingOutputs = ['full-results', 'full-report', 'results', 'current-screenshots', 'video-evidence'];
const credentialKeys = ['E2E_TEST_USERNAME', 'E2E_TEST_PASSWORD', 'E2E_CREATION_USERNAME',
  'E2E_CREATION_PASSWORD', 'VISUAL_USERNAME', 'VISUAL_PASSWORD', 'E2E_CREATION_STORAGE_STATE_FILE'];

export function groupEnvironment(group, base) {
  const env = { ...base, IOS_GROUP: group.group, IOS_LOCALE: group.locale,
    IOS_FILTER: group.filter, IOS_VISUAL_MODE: group.mode || base.IOS_VISUAL_MODE,
    IOS_ANIMATION_RECORD_ONLY: group.recordOnly ? '1' : '0',
    ANIMATION_CASE: group.animation || '', ANIMATION_PART: group.animationPart || '',
    CLRN_CI_ACCOUNT: group.account };
  for (const key of [...credentialKeys, 'CLRN_IOS_CI_TEST_ACCOUNTS', 'GITHUB_ENV']) delete env[key];
  return env;
}

export function fullTestArgs(group) {
  return ['run', 'test:ios:full', '--', '--grep', group.filter,
    ...(group.playwrightShard ? ['--shard', group.playwrightShard, '--fully-parallel', '--workers', '1'] : [])];
}

export function validateCompletedReport(report) {
  const tests = [...reportSpecs(report)].flatMap(spec => spec.tests);
  if (!tests.length || report.errors?.length) throw new Error('报告为空或测试进程出错');
  if (!tests.every(test => test.expectedStatus === 'passed' && test.status === 'expected'
    && test.results.length === 1 && test.results[0].status === 'passed')) {
    throw new Error('报告包含失败、取消、跳过或未执行的测试');
  }
}

function simctl(args) {
  return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', timeout: 180_000 });
}

function resetSimulator(udid) {
  const devices = Object.values(JSON.parse(simctl(['list', '-j', 'devices'])).devices).flat();
  for (const device of devices.filter(device => device.name.startsWith('clrn-isolated-'))) {
    simctl(['delete', device.udid]);
  }
  const device = devices.find(device => device.udid === udid);
  if (!device) throw new Error('专用模拟器不存在');
  if (device.state === 'Booted') {
    // Shutdown terminates the app, WDA and recording services as well.
    simctl(['shutdown', udid]);
  }
  simctl(['erase', udid]);
}

export function nativeHooks(plan, base, signal) {
  assertHostedRunner(base);
  if (!/^[a-f\d-]{36}$/i.test(base.IOS_SIMULATOR_UDID || '')) throw new Error('缺少专用模拟器');
  if (plan.account !== base.CLRN_IOS_ACCOUNT_LOCK) throw new Error('账号与 job 独占锁不一致');
  const root = resolve('ios/artifacts/business', plan.business);
  mkdirSync(root, { recursive: true });
  let env;
  const run = (command, args, cancellable = true) => runCiCommand(command, args, env, cancellable ? signal : undefined);
  const node = (script, args = []) => run(process.execPath, [script, ...args]);
  return {
    cancelled: () => signal.aborted,
    async prepare(group) {
      env = groupEnvironment(group, base);
      if (group.account && group.account !== plan.account) throw new Error('分组越过账号独占锁');
      for (const output of workingOutputs) rmSync(resolve('ios/artifacts', output), { recursive: true, force: true });
      restoreSystemProxy(base);
      resetSimulator(base.IOS_SIMULATOR_UDID);
      if (!group.account) return;
      // configure-ci-account writes to a private per-process env file, never to
      // GITHUB_ENV: subsequent guest/Staging processes must not inherit a login.
      const file = join(base.RUNNER_TEMP, 'clrn-group-credentials');
      writeFileSync(file, '', { mode: 0o600 });
      try {
        await runCiCommand(process.execPath, ['scripts/configure-ci-account.mjs'], { ...env, GITHUB_ENV: file, CLRN_IOS_CI_TEST_ACCOUNTS: base.CLRN_IOS_CI_TEST_ACCOUNTS }, signal);
        for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
          const index = line.indexOf('=');
          env[line.slice(0, index)] = line.slice(index + 1);
        }
      } finally { rmSync(file, { force: true }); }
    },
    async test(group) {
      await run('npm', group.group === 'staging' ? ['run', 'test:ios'] : fullTestArgs(group));
    },
    async validate(group) {
      if (group.group === 'staging') return validateStagingReport(readJson('ios/artifacts/results/report.json'), group.filter);
      validateCompletedReport(readJson('ios/artifacts/full-results/report.json'));
      if (group.group === 'guest' && !group.animation) {
        await node('ios/full/screenshot-evidence.mjs', ['ios/artifacts', 'ios/artifacts/current-screenshots', group.locale, group.shard]);
      }
      if (group.animation) await node('ios/full/animation-gate.mjs', ['ios/artifacts/full-results/report.json', group.animation]);
    },
    async cleanup() {
      try { restoreSystemProxy(base); }
      finally { resetSimulator(base.IOS_SIMULATOR_UDID); }
    },
    async archive(group) {
      await archiveGroupArtifacts(group, { root, env, artifactRoot: resolve('ios/artifacts'), snapshots: resolve('ios/snapshots'),
        exportVideo: () => run(process.execPath, ['ios/full/video-evidence.mjs', 'ios/artifacts', 'ios/artifacts/video-evidence'], false) });
    },
    async save(results) {
      writeFileSync(join(root, 'results.json'), JSON.stringify({ plan, results, applicationId,
        run: base.GITHUB_RUN_ID, attempt: base.GITHUB_RUN_ATTEMPT }, null, 2));
      const summaries = results.filter(result => result.status === 'failed').map(result => {
        const reportFile = join(root, groupKey(result.group), 'full-results/report.json');
        return renderJobFailure({ label: result.group.label,
          report: optionalReport(reportFile),
          testStep: result.errors.map(error => error.phase).join(', '),
          runUrl: `${base.GITHUB_SERVER_URL}/${base.GITHUB_REPOSITORY}/actions/runs/${base.GITHUB_RUN_ID}` });
      });
      writeFileSync(join(root, 'summary.md'), summaries.join('\n'));
    },
  };
}

export function validateStagingReport(report, filter) {
  const expected = selectScenarios(filter).map(scenario => scenario.name);
  const actual = report.scenarios.map(scenario => scenario.name);
  if (report.setupError || JSON.stringify(actual) !== JSON.stringify(expected)
    || report.scenarios.some(scenario => scenario.error || scenario.checks.some(check => !check.matches))) {
    throw new Error('Staging 报告未通过或覆盖不完整');
  }
}

export async function archiveGroupArtifacts(group, { root, env, artifactRoot, snapshots, exportVideo }) {
  const directory = join(root, groupKey(group));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'group.json'), JSON.stringify({ group, run: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT, mode: env.IOS_VISUAL_MODE }, null, 2));
  try {
    if (existsSync(join(artifactRoot, 'full-results/report.json'))) await exportVideo();
  } finally {
    // Export failures must not discard the original screenshots or videos.
    for (const name of [...workingOutputs, 'release/build-info.json']) {
      const source = join(artifactRoot, name);
      if (existsSync(source)) cpSync(source, join(directory, name), { recursive: true });
    }
    if (env.IOS_VISUAL_MODE === 'reference') {
      cpSync(snapshots, join(directory, 'reference-candidates'), { recursive: true });
    }
  }
}

function optionalReport(file) {
  try { return readJson(file); } catch { return null; }
}

function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }

export function writeBusinessSummary(plan, results) {
  const rows = results.map(result => `| ${groupKey(result.group)} | ${result.status} | ${Math.round((result.testMs || 0) / 1000)} |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### ${plan.label} 分组结果\n\n| 分组 | 状态 | 测试秒数 |\n| --- | --- | --- |\n${rows.join('\n')}\n\n`
    + '业务产物中各分组的 current-screenshots/index.html、video-evidence/index.html 可直接浏览；results.json 记录准备、测试、清理和归档耗时。\n');
}
