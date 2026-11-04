import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { digest, fingerprint, partition, priorFailures, scheduleSummary, stageMatrix } from './ci-schedule.mjs';
import { GitHubHistory, scopeForRun } from './ci-schedule-history.mjs';

const configurationFiles = ['.github/workflows/ios-full.yml', '.github/actions/ios-native/action.yml',
  'scripts/plan-ci-accounts.mjs', 'scripts/ci-accounts.mjs', 'ios/full/select-ci-matrix.mjs',
  'scripts/ci-schedule.mjs', 'scripts/ci-schedule-history.mjs', 'scripts/plan-ci-schedule.mjs'];
const configuration = digest(configurationFiles.map(file => [file, readFileSync(file, 'utf8')]));
const matrix = JSON.parse(process.env.IOS_CI_MATRIX);
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const history = new GitHubHistory({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN,
  apiUrl: process.env.GITHUB_API_URL });
const plan = { schema: 1, matrix, configuration, fingerprint: fingerprint(matrix, configuration),
  runId: process.env.GITHUB_RUN_ID, sha: process.env.GITHUB_SHA, checkoutSha: process.env.GITHUB_SHA, scope: null,
  history: '', reason: '无有效历史，执行当前完整计划' };
let priority = [];
try {
  const current = await history.json(`/actions/runs/${plan.runId}`);
  plan.scope = scopeForRun(current, event, process.env.GITHUB_REPOSITORY);
  // 保存 API 的 head_sha 用于校验历史 artifact；执行仍由 checkout 验证当前提交。
  plan.sha = current.head_sha;
  if (process.env.CI_FORCE_FULL === 'true' || current.event === 'workflow_dispatch') {
    plan.reason = '手动全量执行当前所选测试范围';
  } else {
    const previous = await history.previousRun(current, plan.scope);
    if (previous) {
      plan.history = previous.html_url;
      priority = priorFailures(plan, await history.plan(previous), await history.jobs(previous));
      plan.reason = priority.length ? '先验证最近同 PR/分支及 workflow 的未成功分片' : '上轮全部成功，执行当前完整计划';
    }
  }
} catch (error) {
  priority = [];
  plan.reason = `安全回退全量：${error.message}`;
}
const scheduled = partition(plan, priority);
mkdirSync('ios/artifacts/ci-schedule', { recursive: true });
writeFileSync('ios/artifacts/ci-schedule/plan.json', `${JSON.stringify(scheduled, null, 2)}\n`);
appendFileSync(process.env.GITHUB_STEP_SUMMARY, scheduleSummary(scheduled));
const outputs = { priority: JSON.stringify(stageMatrix(scheduled, 'priority')),
  remaining: JSON.stringify(stageMatrix(scheduled, 'remaining')),
  artifact_name: `ios-ci-plan-${process.env.GITHUB_RUN_ATTEMPT}`,
  has_priority: scheduled.priority.length > 0, has_remaining: scheduled.remaining.length > 0 };
for (const [key, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
