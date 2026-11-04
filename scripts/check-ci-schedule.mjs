import { appendFileSync, readFileSync } from 'node:fs';
import { gatePassed, scheduleSummary } from './ci-schedule.mjs';
import { GitHubHistory } from './ci-schedule-history.mjs';
import { renderMetrics } from './ci-schedule-metrics.mjs';

const results = JSON.parse(process.env.CI_STAGE_RESULTS);
const plan = JSON.parse(readFileSync('ios/artifacts/ci-schedule/plan.json', 'utf8'));
const passed = gatePassed(plan, results);
appendFileSync(process.env.GITHUB_STEP_SUMMARY, scheduleSummary(plan)
  + `\n### 本轮阶段结果\n\n${Object.entries(results).map(([name, result]) => `- ${name}：${result}`).join('\n')}\n\n`
  + `当前提交全量门禁：**${passed ? '成功' : '失败'}**。优先阶段成功不代表全量成功。\n`);
if (process.env.CI_SCHEDULE_METRICS === 'true') {
  try {
    const history = new GitHubHistory({ repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GH_TOKEN, apiUrl: process.env.GITHUB_API_URL });
    const run = await history.json(`/actions/runs/${process.env.GITHUB_RUN_ID}`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderMetrics(plan, run, await history.jobs(run), passed));
  } catch (error) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n调度耗时数据暂不可用：${error.message}。门禁仍依据本轮阶段结果。\n`);
  }
}
if (!passed) throw new Error('当前提交的全部必需分片尚未成功');
