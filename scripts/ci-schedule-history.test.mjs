import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GitHubHistory, runMatches, scopeForRun } from './ci-schedule-history.mjs';

const repository = { id: 1, full_name: 'appcookie/clrn-pg' };
const head = { id: 2, full_name: 'contributor/clrn-pg' };
const pull = { number: 34, head: { ref: 'fix-ci', repo: head }, base: { ref: 'master', repo: repository } };
const current = { id: 200, workflow_id: 10, path: '.github/workflows/ios-full.yml', event: 'pull_request',
  head_branch: 'fix-ci', repository, head_repository: head, pull_requests: [pull], run_attempt: 1 };
const scope = scopeForRun(current, { pull_request: pull }, repository.full_name);

function api(handler) {
  return new GitHubHistory({ repository: repository.full_name, token: 'test-token', request: async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const result = await handler(new URL(url));
    return result instanceof Response ? result : Response.json(result);
  } });
}

test('历史范围同时隔离事件、分支、PR 编号、head 仓库及 base 仓库', () => {
  assert.equal(runMatches(current, scope), true);
  for (const changed of [{ event: 'push' }, { head_branch: 'other' }, { head_repository: repository },
    { pull_requests: [{ ...pull, number: 35 }] }, { pull_requests: [] },
    { pull_requests: [{ ...pull, base: { repo: head } }] },
    { pull_requests: [{ ...pull, base: { ref: 'another-base', repo: repository } }] }]) {
    assert.equal(runMatches({ ...current, ...changed }, scope), false);
  }
  const push = { ...current, event: 'push', head_branch: 'master', head_repository: repository };
  assert.equal(runMatches(push, scopeForRun(push, {}, repository.full_name)), true);
});

test('历史运行分页排除当前、新于当前和其他 PR，只选择最近同范围运行', async () => {
  const calls = [];
  const history = api(url => {
    calls.push(url);
    assert.equal(url.searchParams.get('event'), 'pull_request');
    assert.equal(url.searchParams.get('branch'), 'fix-ci');
    if (url.searchParams.get('page') === '1') return { workflow_runs: Array.from({ length: 100 }, (_, index) => ({ ...current, id: 300 + index })) };
    return { workflow_runs: [{ ...current, id: 199, pull_requests: [] }, { ...current, id: 198, status: 'completed' }] };
  });
  assert.equal((await history.previousRun(current, scope)).id, 198);
  assert.equal(calls.length, 2);
});

test('最近历史尚未结束时回退，而不跳过它误用更旧运行', async () => {
  const history = api(() => ({ workflow_runs: [{ ...current, id: 199, status: 'in_progress' },
    { ...current, id: 198, status: 'completed' }] }));
  await assert.rejects(history.previousRun(current, scope), /尚未完成/);
  assert.equal(await api(() => ({ workflow_runs: [] })).previousRun(current, scope), undefined);
});

test('API 错误、损坏响应及分页超限都明确失败供调用者回退全量', async () => {
  for (const status of [403, 404, 429, 500]) {
    await assert.rejects(api(() => new Response('', { status })).jobs(current), new RegExp(String(status)));
  }
  await assert.rejects(api(() => ({})).jobs(current), /格式无效/);
  await assert.rejects(api(() => ({ jobs: Array.from({ length: 100 }, (_, id) => ({ id })) })).list('/jobs', 'jobs'), /查询上限/);
});

test('失败重跑按 attempt 合并结果，保留未重跑成功项并覆盖旧失败', async () => {
  const history = api(url => {
    if (url.pathname.includes('/attempts/1/')) return { jobs: [{ name: 'a', conclusion: 'success' }, { name: 'b', conclusion: 'failure' }] };
    assert.match(url.pathname, /\/attempts\/2\/jobs$/);
    return { jobs: [{ name: 'b', conclusion: 'success' }] };
  });
  assert.deepEqual(await history.jobs({ ...current, run_attempt: 2 }), [{ name: 'a', conclusion: 'success' }, { name: 'b', conclusion: 'success' }]);
  await assert.rejects(api(() => ({ jobs: [{ name: 'duplicate' }, { name: 'duplicate' }] })).jobs(current), /重复/);
});

function archive(t, contents) {
  const directory = mkdtempSync(join(tmpdir(), 'ci-plan-archive-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'plan.json'), JSON.stringify(contents));
  execFileSync('zip', ['-q', 'plan.zip', 'plan.json'], { cwd: directory });
  return readFileSync(join(directory, 'plan.zip'));
}

test('从原 attempt 读取 plan.json，验证 run ID 和 SHA；过期、缺失或超大产物拒绝读取', async t => {
  const contents = { runId: '200', sha: 'a'.repeat(40), matrix: { include: [] } };
  const zip = archive(t, contents);
  const artifact = { id: 10, name: 'ios-ci-plan-1', expired: false, size_in_bytes: zip.length };
  const run = { ...current, run_attempt: 2, head_sha: contents.sha };
  const history = api(url => url.pathname.endsWith('/zip') ? new Response(zip) : { artifacts: [artifact] });
  assert.deepEqual(await history.plan(run), contents);
  await assert.rejects(history.plan({ ...run, head_sha: 'b'.repeat(40) }), /运行身份/);
  for (const artifacts of [[], [{ ...artifact, expired: true }], [{ ...artifact, size_in_bytes: 2 ** 21 }]]) {
    await assert.rejects(api(() => ({ artifacts })).plan(run), /缺失|过大/);
  }
});
