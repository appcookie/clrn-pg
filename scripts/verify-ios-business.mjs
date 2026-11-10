import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { assertGroupsPassed } from './ios-ci-groups.mjs';

export function verifyBusinessResults(matrix, reports, run, attempt) {
  if (!matrix.include.length || matrix.include.length !== reports.length) throw new Error('业务结果数量与计划不一致');
  for (const plan of matrix.include) {
    const matches = reports.filter(report => report.plan.business === plan.business);
    if (matches.length !== 1) throw new Error(`缺少或重复业务结果：${plan.business}`);
    const report = matches[0];
    if (report.run !== run || !validAttempt(report.attempt, attempt) || !isDeepStrictEqual(report.plan, plan)) {
      throw new Error('业务结果来源或计划不一致');
    }
    assertGroupsPassed(plan.groups, report.results);
  }
}

// Rerun-failed-jobs reuses successful jobs from previous attempts of this run.
// The per-business status artifact is replaced whenever that business reruns.
function validAttempt(actual, current) {
  return /^[1-9]\d*$/.test(actual) && BigInt(actual) <= BigInt(current);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve('ci-failures');
  const reports = readdirSync(root).map(name => JSON.parse(readFileSync(join(root, name, 'results.json'), 'utf8')));
  verifyBusinessResults(JSON.parse(process.env.IOS_BUSINESS_MATRIX), reports,
    process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT);
}
