import { appendFileSync } from 'node:fs';
import { iosAccountMatrix, availableCiAccounts } from './ci-accounts.mjs';

if (!process.env.GITHUB_OUTPUT) throw new Error('账号调度脚本只能由 GitHub Actions 执行。');
if (process.argv[2] !== 'ios') throw new Error('账号调度模式必须为 ios。');
const group = process.env.CI_IOS_GROUP || 'pr';
// 游客任务不读取账号 Secret，也不执行账号准备。
const accounts = group === 'guest' ? [] : availableCiAccounts(process.env.CLRN_IOS_CI_TEST_ACCOUNTS);
const matrix = iosAccountMatrix(process.env.GITHUB_RUN_ID, group, process.env.CI_IOS_LOCALE || 'all', accounts);
if (process.env.CI_ANIMATION_CASE) {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !['pr', 'animations'].includes(group)) {
    throw new Error('单组录屏仅允许显式手动运行，PR 门禁不能缩减');
  }
  const selected = process.env.CI_ANIMATION_CASE.split(',').map(value => value.trim());
  if (selected.some(value => !/^animation-(?:[1-9]|1\d|2[0-5])$/.test(value))
    || new Set(selected).size !== selected.length) throw new Error('录屏分片清单无效或重复');
  const wanted = new Set(selected);
  matrix.include = matrix.include.filter(entry => wanted.has(entry.animation));
  if (matrix.include.length !== wanted.size) throw new Error('指定动画用例不存在');
}
appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
