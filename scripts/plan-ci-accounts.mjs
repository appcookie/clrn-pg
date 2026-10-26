import { appendFileSync } from 'node:fs';
import { iosAccountMatrix, availableCiAccounts, quarantinedAnimationCases } from './ci-accounts.mjs';
import animationInventory from '../ios/full/animation-gate-cases.json' with { type: 'json' };

if (!process.env.GITHUB_OUTPUT) throw new Error('账号调度脚本只能由 GitHub Actions 执行。');
if (process.argv[2] !== 'ios') throw new Error('账号调度模式必须为 ios。');
const group = process.env.CI_IOS_GROUP || 'pr';
// 游客任务不读取账号 Secret，也不执行账号准备。
const accounts = group === 'guest' ? [] : availableCiAccounts(process.env.CLRN_IOS_CI_TEST_ACCOUNTS);
const matrix = iosAccountMatrix(process.env.GITHUB_RUN_ID, group, process.env.CI_IOS_LOCALE || 'all', accounts);
const requestedFunctionalCase = process.env.CI_FUNCTIONAL_CASE || 'all';
if (requestedFunctionalCase !== 'all') {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || group !== 'functional'
    || requestedFunctionalCase !== 'club-search-results' || matrix.include.length !== 5) {
    throw new Error('定向功能用例仅允许手动运行英文俱乐部搜索功能组，不能缩减 PR 门禁。');
  }
  matrix.include = [{ ...matrix.include[0], shard: 'club-search-results',
    filter: 'CLUB-007/1 俱乐部搜索命中固定结果并显示原生卡片$', playwrightShard: '',
    label: 'functional / en / 俱乐部搜索命中结果' }];
}
if (process.env.CI_ANIMATION_CASE) {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !['pr', 'animations', 'quarantined'].includes(group)) {
    throw new Error('单组录屏仅允许显式手动运行，PR 门禁不能缩减');
  }
  const selected = process.env.CI_ANIMATION_CASE.split(',').map(value => value.trim());
  if (selected.some(value => !/^animation-(?:[1-9]|1\d|2[0-5])$/.test(value)
      && !(group !== 'animations' && /^animation-20\/(?:themes|voice_records|interactions)$/.test(value)))
    || new Set(selected).size !== selected.length) throw new Error('录屏分片清单无效或重复');
  const wanted = new Set(selected);
  const matches = (entry, value) => entry.animation === value
    || (entry.animationPart && `${entry.animation}/${entry.animationPart}` === value);
  if (selected.some(value => !matrix.include.some(entry => matches(entry, value)))) {
    throw new Error('指定动画用例不存在');
  }
  matrix.include = matrix.include.filter(entry => selected.some(value => matches(entry, value)));
}
appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
if (group === 'pr' && process.env.GITHUB_STEP_SUMMARY) {
  const active = new Set(matrix.include.filter(item => item.animation).map(item => item.animation));
  const guestShards = matrix.include.filter(item => item.group === 'guest' && !item.animation).length;
  const listed = quarantinedAnimationCases.map(item => `- \`${item.id}\`: ${item.reason}`).join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### iOS PR 验证范围\n\n本轮安排 ${active.size} 组录屏和 ${guestShards} 个游客截图分片。`
    + `以下 ${quarantinedAnimationCases.length} 组暂不运行，不能视为通过；清单见 \`ios/full/quarantined/\`。\n\n${listed}\n\n`
    + `原清单共 ${animationInventory.cases.length} 组。动画效果断言由 React Native #7056 后续处理。\n`);
}
