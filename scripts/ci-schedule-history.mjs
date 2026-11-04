import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function runMatches(run, scope) {
  const same = run.event === scope.event && run.head_branch === scope.branch
    && run.head_repository?.full_name === scope.headRepository
    && run.head_repository?.id === scope.headRepositoryId;
  if (!same) return false;
  if (!scope.pr) return true;
  return run.pull_requests?.some(pr => pr.number === scope.pr
    && pr.head?.repo?.id === scope.headRepositoryId && pr.base?.repo?.id === scope.repositoryId
    && pr.base?.ref === scope.baseBranch) === true;
}

export function scopeForRun(run, event, repository) {
  const pr = event.pull_request;
  const source = pr?.head || { ref: run.head_branch, repo: run.head_repository };
  return { repository, repositoryId: run.repository.id, workflow: run.path, workflowId: run.workflow_id,
    event: run.event, branch: source.ref,
    headRepository: source.repo.full_name,
    headRepositoryId: source.repo.id, pr: pr?.number || null,
    baseBranch: pr?.base.ref || null };
}

export class GitHubHistory {
  constructor({ repository, token, apiUrl = 'https://api.github.com', request = fetch }) {
    this.base = `${apiUrl}/repos/${repository}`;
    this.headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28' };
    this.request = request;
  }

  async response(path) {
    const response = await this.request(`${this.base}${path}`, { headers: this.headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`GitHub 历史 API HTTP ${response.status}`);
    return response;
  }

  async json(path) { return (await this.response(path)).json(); }

  async list(path, key, stop = () => false) {
    const entries = [];
    for (let page = 1; page <= 10; page++) {
      const data = await this.json(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(data[key])) throw new Error('GitHub API 列表格式无效');
      entries.push(...data[key]);
      if (data[key].length < 100 || stop(entries)) return entries;
    }
    throw new Error('历史列表超过查询上限，回退全量');
  }

  async previousRun(current, scope) {
    const query = `event=${encodeURIComponent(scope.event)}&branch=${encodeURIComponent(scope.branch)}`;
    const matches = run => BigInt(run.id) < BigInt(current.id) && runMatches(run, scope);
    const runs = await this.list(`/actions/workflows/${current.workflow_id}/runs?${query}`, 'workflow_runs', entries => entries.some(matches));
    const previous = runs.filter(matches)
      .sort((a, b) => b.id - a.id)[0];
    if (previous && previous.status !== 'completed') throw new Error('最近同范围运行尚未完成');
    return previous;
  }

  async plan(run) {
    const artifacts = await this.list(`/actions/runs/${run.id}/artifacts`, 'artifacts');
    const candidates = artifacts.filter(artifact => /^ios-ci-plan-[1-9]\d*$/.test(artifact.name) && !artifact.expired
      && Number(artifact.name.split('-').at(-1)) <= run.run_attempt)
      .sort((a, b) => Number(b.name.split('-').at(-1)) - Number(a.name.split('-').at(-1)));
    if (!candidates.length) throw new Error('历史完整计划缺失或已过期');
    const artifact = candidates[0];
    if (artifact.size_in_bytes > 1024 * 1024) throw new Error('历史计划产物过大');
    const response = await this.response(`/actions/artifacts/${artifact.id}/zip`);
    const directory = mkdtempSync(join(tmpdir(), 'ios-ci-history-'));
    try {
      const file = join(directory, 'plan.zip');
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      // 只读取固定文件，不解压不可信历史文件到工作目录，也不执行其中的代码。
      const plan = JSON.parse(execFileSync('unzip', ['-p', file, 'plan.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
      if (String(plan.runId) !== String(run.id) || plan.sha !== run.head_sha) throw new Error('历史计划运行身份无效');
      return plan;
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }

  async jobs(run) {
    if (!Number.isInteger(run.run_attempt) || run.run_attempt < 1 || run.run_attempt > 10) throw new Error('历史重跑次数无法可靠读取');
    const latest = new Map();
    for (let attempt = 1; attempt <= run.run_attempt; attempt++) {
      const jobs = await this.list(`/actions/runs/${run.id}/attempts/${attempt}/jobs`, 'jobs');
      if (new Set(jobs.map(job => job.name)).size !== jobs.length) throw new Error('同次重跑的检查名称重复');
      for (const job of jobs) latest.set(job.name, job);
    }
    return [...latest.values()];
  }
}
