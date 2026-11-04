import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { parse } from 'yaml';

const read = path => parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const workflow = read('../.github/workflows/ios-full.yml');
const native = read('../.github/actions/ios-native/action.yml');
const aggregate = workflow.jobs['screenshot-video-gate'];
const expression = text => text.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
  .replace(/needs\.([a-z]+-[a-z-]+)/g, "needs['$1']");

test('手动诊断不能发布与 PR/master 门禁同名的 skipped 检查', () => {
  const evaluate = event => runInNewContext(expression(aggregate.name), { github: { event_name: event } });
  assert.equal(evaluate('pull_request'), 'iOS screenshot and video gate');
  assert.equal(evaluate('push'), 'iOS screenshot and video gate');
  assert.equal(evaluate('workflow_dispatch'), 'iOS recording diagnostics');
});

test('第 20 组分段身份传入录屏验收，两个阶段共用原有产物及清理步骤', () => {
  const step = native.runs.steps.find(step => step.name === '校验本轮录屏存在且文件有效');
  assert.equal(step.env.ANIMATION_PART, '${{ fromJSON(inputs.entry).animationPart }}');
  for (const id of ['native-priority', 'native']) {
    const job = workflow.jobs[id];
    assert.equal(job.strategy['max-parallel'], 10);
    assert.match(job.concurrency.group, /matrix.account/);
    assert.equal(job.concurrency.queue, 'max');
    assert.equal(job.name, '${{ matrix.label }}');
    assert.equal(job.steps[1].uses, './.github/actions/ios-native');
    assert.equal(job.steps[1].with.build_artifact, '${{ needs.target-build.outputs.artifact_name }}');
  }
  const cleanup = native.runs.steps.find(step => step.name === '删除专用模拟器');
  assert.match(cleanup.if, /always\(\)/);
  for (const step of native.runs.steps.filter(step => step.run)) assert.equal(step.shell, 'bash');
});

test('正式汇总在前置失败、取消、跳过后仍执行，不能被默认依赖条件跳过', () => {
  assert.deepEqual(aggregate.needs, ['plan', 'proxy-check', 'target-build', 'native-priority', 'native']);
  for (const event of ['pull_request', 'push']) {
    assert.equal(runInNewContext(expression(aggregate.if), {
      github: { event_name: event }, always: () => true,
    }), true);
  }
  assert.equal(runInNewContext(expression(aggregate.if), {
    github: { event_name: 'workflow_dispatch' }, always: () => true,
  }), false);
  const gate = aggregate.steps.find(step => step.run === 'node scripts/check-ci-schedule.mjs');
  assert.equal(gate.if, 'always()');
  assert.match(gate.env.CI_STAGE_RESULTS, /native-priority.result/);
});

function remainingAllowed(priority, hasPriority = 'true', overrides = {}) {
  const needs = { plan: { result: 'success', outputs: { run_native: 'true', has_priority: hasPriority, has_remaining: 'true' } },
    'proxy-check': { result: 'success' }, 'target-build': { result: 'success' },
    'native-priority': { result: priority }, ...overrides };
  return runInNewContext(expression(workflow.jobs.native.if), { needs, always: () => true, cancelled: () => false });
}

test('实际工作流依赖阻止优先失败、取消、跳过时提交剩余重型任务', () => {
  assert.deepEqual(workflow.jobs.native.needs, ['plan', 'proxy-check', 'target-build', 'native-priority']);
  assert.equal(remainingAllowed('success'), true);
  for (const result of ['failure', 'cancelled', 'skipped', '']) assert.equal(remainingAllowed(result), false);
  assert.equal(remainingAllowed('skipped', 'false'), true);
  assert.equal(remainingAllowed('success', 'false'), false);
  for (const id of ['proxy-check', 'target-build']) {
    assert.equal(remainingAllowed('success', 'true', { [id]: { result: 'failure' } }), false);
  }
});

test('失败重跑复用原计划和目标包的产物名，不要求成功依赖在新 attempt 重跑', () => {
  const planDownload = aggregate.steps.find(step => step.name === '读取本轮完整计划');
  assert.equal(planDownload.with.name, '${{ needs.plan.outputs.artifact_name }}');
  const buildDownload = native.runs.steps.find(step => step.uses === 'actions/download-artifact@v4');
  assert.equal(buildDownload.with.name, '${{ inputs.build_artifact }}');
  assert.match(workflow.jobs['target-build'].outputs.artifact_name, /github.run_attempt/);
});
