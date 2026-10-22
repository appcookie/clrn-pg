import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ios-full.yml', import.meta.url), 'utf8');
const aggregate = workflow.split('\n  animation-gate:\n')[1];
assert.ok(aggregate, '完整动画必须有独立汇总 job');
const name = aggregate.match(/\n    name: \$\{\{\s*(.*?)\s*\}\}/)?.[1];
const condition = aggregate.match(/\n    if: (.*)/)?.[1];
const command = aggregate.match(/\n        run: (.*)/)?.[1];

test('手动诊断不能发布与 PR/master 门禁同名的 skipped 检查', () => {
  assert.ok(name, '检查名必须区分手动诊断和正式门禁');
  const evaluate = event => runInNewContext(name, { github: { event_name: event } });
  assert.equal(evaluate('pull_request'), 'iOS animation gate');
  assert.equal(evaluate('push'), 'iOS animation gate');
  assert.equal(evaluate('workflow_dispatch'), 'iOS animation diagnostics');
});

test('正式汇总在前置失败、取消、跳过后仍执行，不能被默认依赖条件跳过', () => {
  assert.ok(condition);
  assert.match(aggregate, /needs: \[plan, proxy-check, native\]/);
  for (const event of ['pull_request', 'push']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      assert.equal(runInNewContext(condition, {
        github: { event_name: event }, always: () => true,
        needs: { plan: { result }, 'proxy-check': { result }, native: { result } },
      }), true);
    }
  }
  assert.equal(runInNewContext(condition, {
    github: { event_name: 'workflow_dispatch' }, always: () => true,
  }), false);
});

test('真实汇总命令仅接受全部成功，任一失败、取消或跳过均返回失败', () => {
  assert.ok(command);
  const results = ['success', 'failure', 'cancelled', 'skipped'];
  for (const PLAN of results) for (const PREFLIGHT of results)
    for (const PROXY of results) for (const NATIVE of results) {
      const result = spawnSync('sh', ['-c', command],
        { env: { ...process.env, PLAN, PREFLIGHT, PROXY, NATIVE } });
      assert.equal(result.status === 0,
        [PLAN, PREFLIGHT, PROXY, NATIVE].every(value => value === 'success'));
  }
});
