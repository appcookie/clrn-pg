// GitHub's created -> started interval includes scheduling/account-lock wait;
// it is not a measurement of machine startup alone.
import { appendFileSync } from 'node:fs';

export function jobTiming(job) {
  const seconds = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  const test = job.steps.find(step => step.name === '顺序执行全部逻辑分组，失败后清理并继续');
  return { name: job.name, wait: seconds(job.created_at, job.started_at),
    setup: seconds(job.started_at, test?.started_at),
    test: seconds(test?.started_at, test?.completed_at),
    total: seconds(job.started_at, job.completed_at), conclusion: job.conclusion };
}

export async function recordTimings(env = process.env) {
  const jobs = [];
  for (let page = 1; ; page++) {
    const url = `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      + `/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100&page=${page}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${env.GH_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`读取 CI 耗时失败：${response.status}`);
    const batch = (await response.json()).jobs;
    jobs.push(...batch);
    if (batch.length < 100) break;
  }
  const rows = jobs.filter(job => ['App', '德州', '拼三张'].includes(job.name)).map(jobTiming);
  const number = value => Number.isFinite(value) ? value : '未执行';
  appendFileSync(env.GITHUB_STEP_SUMMARY,
    '\n### 业务 runner 实测耗时（秒）\n\n| 业务 | 排队及锁等待 | 初始化 | 分组执行及归档 | 总执行 | 结果 |\n| --- | --- | --- | --- | --- | --- |\n'
    + rows.map(row => `| ${row.name} | ${number(row.wait)} | ${number(row.setup)} | ${number(row.test)} | ${number(row.total)} | ${row.conclusion} |`).join('\n')
    + '\n\n分组内各阶段耗时见 results.json。排队包含 GitHub 调度及账号锁等待。\n');
}

if (process.argv[1]?.endsWith('/ios-ci-timing.mjs')) await recordTimings();
