import { appendFileSync } from 'node:fs';
import { iosAccountMatrix, availableCiAccounts } from './ci-accounts.mjs';

if (!process.env.GITHUB_OUTPUT) throw new Error('账号调度脚本只能由 GitHub Actions 执行。');
if (process.argv[2] !== 'ios') throw new Error('账号调度模式必须为 ios。');
const group = process.env.CI_IOS_GROUP || 'pr';
// 游客任务不读取账号 Secret，也不执行账号准备。
const accounts = group === 'guest' ? [] : availableCiAccounts(process.env.CLRN_IOS_CI_TEST_ACCOUNTS);
const matrix = iosAccountMatrix(process.env.GITHUB_RUN_ID, group, process.env.CI_IOS_LOCALE || 'all', accounts);
if (process.env.CI_ANIMATION_CASE) {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || group !== 'animations') {
    throw new Error('单项动画诊断只允许显式手动 animations 运行，PR 门禁不能缩减');
  }
  matrix.include = matrix.include.filter(entry => entry.animation === process.env.CI_ANIMATION_CASE);
  if (matrix.include.length !== 1) throw new Error('指定动画用例不存在');
}
appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
