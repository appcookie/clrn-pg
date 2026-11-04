import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { stageMatrix } from './ci-schedule.mjs';

const execute = promisify(execFile);

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ci-schedule-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of ['.github', 'scripts', 'ios/full/select-ci-matrix.mjs']) {
    const target = join(directory, path);
    mkdirSync(join(target, '..'), { recursive: true });
    cpSync(new URL(`../${path}`, import.meta.url), target, { recursive: true });
  }
  const responses = new Map();
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const body = responses.get(path);
    if (!body) { response.writeHead(403).end(); return; }
    response.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const repository = { id: 1, full_name: 'fixture/repo' };
  const pull = { number: 34, head: { ref: 'fix-ci', repo: repository }, base: { ref: 'master', repo: repository } };
  const runs = [];
  const include = Array.from({ length: 20 }, (_, index) => ({ group: 'guest', locale: 'en', shard: String(index), label: `shard ${index}` }));
  const prefix = '/repos/fixture/repo';
  const env = { ...process.env, GH_TOKEN: 'fixture-token', GITHUB_REPOSITORY: repository.full_name,
    GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ATTEMPT: '1',
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_EVENT_PATH: join(directory, 'event.json'), GITHUB_OUTPUT: join(directory, 'outputs'),
    GITHUB_STEP_SUMMARY: join(directory, 'summary.md') };
  writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify({ pull_request: pull }));
  const script = (name, overrides = {}) => execute(process.execPath, [`scripts/${name}.mjs`], { cwd: directory, env: { ...env, ...overrides } });

  async function run(id, matrix = { include }, event = 'pull_request') {
    const metadata = { id, workflow_id: 10, path: '.github/workflows/ios-full.yml', event, repository,
      head_repository: repository, head_branch: 'fix-ci', head_sha: 'a'.repeat(40), pull_requests: [pull],
      status: 'completed', run_attempt: 1, html_url: `https://github.com/fixture/repo/actions/runs/${id}` };
    responses.set(`${prefix}/actions/runs/${id}`, metadata);
    responses.set(`${prefix}/actions/workflows/10/runs`, { workflow_runs: [...runs].reverse() });
    await script('plan-ci-schedule', { GITHUB_RUN_ID: String(id), IOS_CI_MATRIX: JSON.stringify(matrix) });
    const plan = JSON.parse(readFileSync(join(directory, 'ios/artifacts/ci-schedule/plan.json'), 'utf8'));
    return { metadata, plan };
  }

  function remember({ metadata, plan }, jobs) {
    runs.push(metadata);
    const archive = join(directory, 'plan.zip');
    execFileSync('zip', ['-q', '-j', archive, join(directory, 'ios/artifacts/ci-schedule/plan.json')]);
    const zip = readFileSync(archive);
    responses.set(`${prefix}/actions/runs/${metadata.id}/artifacts`, { artifacts: [{ id: metadata.id,
      name: 'ios-ci-plan-1', size_in_bytes: zip.length, expired: false }] });
    responses.set(`${prefix}/actions/artifacts/${metadata.id}/zip`, zip);
    responses.set(`${prefix}/actions/runs/${metadata.id}/attempts/1/jobs`, { jobs });
    assert.equal(plan.runId, String(metadata.id));
  }
  return { directory, env, include, run, remember, script, responses, prefix };
}

const jobs = (entries, conclusion) => entries.map(entry => ({ name: entry.label, status: 'completed', conclusion }));

test('真实 CLI 和本地 HTTP/ZIP 历史：全量 → 3/17 → 连续失败仍 3/17 → 全部通过后下轮全量', async t => {
  const f = await fixture(t);
  const first = await f.run(100);
  assert.equal(first.plan.remaining.length, 20);
  f.remember(first, [...jobs(f.include.slice(0, 3), 'failure'), ...jobs(f.include.slice(3), 'success')]);
  const second = await f.run(101);
  assert.equal(second.plan.priority.length, 3);
  assert.equal(second.plan.remaining.length, 17);
  const results = { plan: 'success', preflight: 'success', proxy: 'success', build: 'success', priority: 'failure', remaining: 'skipped' };
  await assert.rejects(f.script('check-ci-schedule', { CI_STAGE_RESULTS: JSON.stringify(results) }), error => error.code === 1);
  assert.match(readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8'), /当前提交全量门禁：\*\*失败/);
  f.remember(second, jobs(stageMatrix(second.plan, 'priority').include, 'failure'));
  const third = await f.run(102);
  assert.equal(third.plan.priority.length, 3);
  assert.equal(third.plan.remaining.length, 17);
  await f.script('check-ci-schedule', { CI_STAGE_RESULTS: JSON.stringify({ ...results, priority: 'success', remaining: 'success' }) });
  f.remember(third, jobs(f.include, 'success'));
  const fourth = await f.run(103);
  assert.equal(fourth.plan.priority.length, 0);
  assert.equal(fourth.plan.remaining.length, 20);
});

test('真实 CLI：手动、API 不可用、配置变化和新增分片均全量，保留新增项', async t => {
  const f = await fixture(t);
  const first = await f.run(100);
  f.remember(first, jobs(f.include, 'failure'));
  const manual = await f.run(101, { include: f.include }, 'workflow_dispatch');
  assert.equal(manual.plan.priority.length, 0);
  assert.match(manual.plan.reason, /手动全量/);
  const added = [...f.include, { group: 'guest', locale: 'en', shard: 'new', label: 'new shard' }];
  const changed = await f.run(102, { include: added });
  assert.equal(changed.plan.remaining.length, 21);
  assert.match(changed.plan.reason, /安全回退全量/);
  writeFileSync(join(f.directory, 'scripts/ci-accounts.mjs'), 'changed configuration');
  const incompatible = await f.run(103);
  assert.equal(incompatible.plan.remaining.length, 20);
  assert.match(incompatible.plan.reason, /不兼容/);
  f.responses.delete(`${f.prefix}/actions/runs/100/artifacts`);
  const unavailable = await f.run(104);
  assert.equal(unavailable.plan.remaining.length, 20);
  assert.match(unavailable.plan.reason, /HTTP 403/);
  await assert.rejects(f.script('check-ci-schedule', { CI_STAGE_RESULTS: '{}' }), error => error.code === 1);
});
