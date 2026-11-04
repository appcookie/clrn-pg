import assert from 'node:assert/strict';
import test from 'node:test';
import { fingerprint, gatePassed, partition, priorFailures, shardId, stageMatrix, validatePartition } from './ci-schedule.mjs';
import { ciAccounts, iosAccountMatrix } from './ci-accounts.mjs';

const matrix = { include: Array.from({ length: 20 }, (_, index) => ({ group: 'guest', locale: 'en',
  shard: `part-${index}`, label: `guest / en / part-${index}`, filter: `case-${index}`, account: '' })) };
const scope = { repository: 'appcookie/clrn-pg', workflow: 'ios-full.yml', pr: 34 };
function plan(currentMatrix = matrix, configuration = 'config-v1') {
  return partition({ schema: 1, matrix: currentMatrix, configuration, scope,
    fingerprint: fingerprint(currentMatrix, configuration) });
}
function jobsFor(entries, failures = new Map()) {
  return entries.map(entry => ({ name: entry.label, status: 'completed', conclusion: failures.get(entry.shard) || 'success' }));
}
const prerequisites = { plan: 'success', preflight: 'success', proxy: 'success', build: 'success' };

test('无历史完整安排 20 项，首次失败 3 项后严格分成 3 + 17 且不重复', () => {
  const first = plan();
  assert.equal(first.priority.length, 0);
  assert.equal(first.remaining.length, 20);
  const failed = new Map(['part-1', 'part-7', 'part-19'].map(id => [id, 'failure']));
  const priority = priorFailures(first, first, jobsFor(matrix.include, failed));
  const next = partition(first, priority);
  assert.equal(stageMatrix(next, 'priority').include.length, 3);
  assert.equal(stageMatrix(next, 'remaining').include.length, 17);
  assert.equal(new Set([...next.priority, ...next.remaining]).size, 20);
  assert.equal(gatePassed(next, { ...prerequisites, priority: 'success', remaining: 'success' }), true);
});

test('连续三轮修复保留未放行清单，通过后全部在当前轮验证', () => {
  let previous = partition(plan(), matrix.include.slice(0, 3).map(shardId));
  for (let round = 0; round < 3; round++) {
    const executed = stageMatrix(previous, 'priority').include;
    const failed = new Map(executed.map(entry => [entry.shard, 'failure']));
    previous = partition(plan(), priorFailures(plan(), previous, jobsFor(executed, failed)));
    assert.equal(previous.priority.length, 3);
    assert.equal(previous.remaining.length, 17);
    assert.equal(gatePassed(previous, { ...prerequisites, priority: 'failure', remaining: 'skipped' }), false);
  }
  const nextJobs = jobsFor(matrix.include, new Map([['part-5', 'failure']]));
  const next = partition(plan(), priorFailures(plan(), previous, nextJobs));
  assert.deepEqual(next.priority, [shardId(matrix.include[5])]);
  assert.equal(next.remaining.length, 19);
});

test('取消、跳过、超时和中立结果均不能视为成功', () => {
  for (const conclusion of ['cancelled', 'skipped', 'timed_out', 'neutral', 'action_required', null]) {
    const failures = new Map([['part-0', conclusion]]);
    const jobs = jobsFor(matrix.include, failures);
    jobs[0].conclusion = conclusion;
    assert.deepEqual(priorFailures(plan(), plan(), jobs), [shardId(matrix.include[0])]);
  }
});

test('缺失、未完成、重复检查及损坏的历史分区拒绝映射', () => {
  const previous = plan();
  const jobs = jobsFor(matrix.include);
  assert.throws(() => priorFailures(previous, previous, jobs.slice(1)), /缺失/);
  assert.throws(() => priorFailures(previous, previous, [...jobs, jobs[0]]), /重复/);
  assert.throws(() => priorFailures(previous, previous, jobs.map(job => ({ ...job, status: 'queued' }))), /未完成/);
  assert.throws(() => validatePartition({ ...previous, remaining: previous.remaining.slice(1) }), /覆盖/);
  assert.throws(() => validatePartition({ ...previous, priority: [previous.remaining[0]] }), /覆盖/);
});

test('新增、删除、重命名、改过滤器或配置、跨 PR 均拒绝复用历史', () => {
  const changes = [matrix.include.slice(1), [...matrix.include, { ...matrix.include[0], shard: 'new', label: 'new' }],
    matrix.include.map(entry => ({ ...entry, label: `${entry.label} renamed` })),
    matrix.include.map(entry => ({ ...entry, filter: 'changed' }))];
  for (const include of changes) assert.throws(() => priorFailures(plan({ include }), plan(), jobsFor(matrix.include)), /不兼容/);
  assert.throws(() => priorFailures(plan(matrix, 'v2'), plan(), []), /不兼容/);
  assert.throws(() => priorFailures({ ...plan(), scope: { ...scope, pr: 35 } }, plan(), []), /不兼容/);
});

test('真实矩阵的 run ID 账号轮转不改变分片身份，本轮仍使用本轮账号', () => {
  const first = iosAccountMatrix('100', 'pr', 'all', ciAccounts);
  const current = iosAccountMatrix('101', 'pr', 'all', ciAccounts);
  assert.equal(fingerprint(first, 'config'), fingerprint(current, 'config'));
  const failed = first.include.find(entry => entry.account);
  const priority = priorFailures(plan(current), plan(first), jobsFor(first.include, new Map([[failed.shard, 'failure']])));
  const selected = stageMatrix(partition(plan(current), priority), 'priority').include[0];
  assert.equal(selected.account, current.include.find(entry => shardId(entry) === shardId(failed)).account);
  assert.notEqual(selected.account, failed.account);
});

function combinations(keys, values, entries = {}) {
  if (!keys.length) return [entries];
  return values.flatMap(value => combinations(keys.slice(1), values, { ...entries, [keys[0]]: value }));
}

test('穷举 4096 种阶段状态：任何实际需要的阶段未成功都阻断', () => {
  const split = partition(plan(), [shardId(matrix.include[0])]);
  const states = combinations(['plan', 'preflight', 'proxy', 'build', 'priority', 'remaining'],
    ['success', 'failure', 'cancelled', 'skipped']);
  for (const results of states) assert.equal(gatePassed(split, results), Object.values(results).every(result => result === 'success'));
});

test('仅无任务阶段允许 skipped；空计划、缺执行、成功被伪造在空阶段均阻断', () => {
  const full = plan();
  assert.equal(gatePassed(full, { ...prerequisites, priority: 'skipped', remaining: 'success' }), true);
  assert.equal(gatePassed(full, { ...prerequisites, priority: 'success', remaining: 'success' }), false);
  const allPriority = partition(full, matrix.include.map(shardId));
  assert.equal(gatePassed(allPriority, { ...prerequisites, priority: 'success', remaining: 'skipped' }), true);
  assert.equal(gatePassed(allPriority, { ...prerequisites, priority: 'success', remaining: 'cancelled' }), false);
  assert.equal(gatePassed(plan({ include: [] }), { ...prerequisites, priority: 'skipped', remaining: 'skipped' }), false);
  assert.throws(() => gatePassed({ ...full, fingerprint: 'corrupted' }, prerequisites), /损坏/);
});
