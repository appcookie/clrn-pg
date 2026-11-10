// Keep the reviewed logical matrix intact; only change where its processes run.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allocateCiAccount, availableCiAccounts } from './ci-accounts.mjs';

const businesses = [
  { business: 'app', label: 'App', timeout: 330 },
  { business: 'texas', label: '德州', timeout: 210 },
  { business: 'pinsanzhang', label: '拼三张', timeout: 240 },
];
const businessOf = entry => ({ texas: 'texas', zhajinhua: 'pinsanzhang' })[entry.group] || 'app';
export const groupKey = entry => `${entry.group}-${entry.locale}-${entry.shard}`;

export function bundleIosMatrix(matrix, runId, accounts, staging = false) {
  if (!Array.isArray(matrix?.include)) throw new Error('缺少逻辑分组计划');
  const entries = [...matrix.include];
  if (staging) entries.push({ group: 'staging', locale: 'en', shard: 'smoke', filter: '',
    mode: 'smoke', account: '', label: 'Staging / en / smoke' });
  if (new Set(entries.map(groupKey)).size !== entries.length) throw new Error('逻辑分组身份重复');
  return { include: businesses.flatMap((business, offset) => {
    const groups = entries.filter(entry => businessOf(entry) === business.business);
    if (!groups.length) return [];
    // One account for the entire job makes job-level concurrency a real lock.
    // With a small pool, jobs sharing an account queue instead of racing.
    const account = groups.some(entry => entry.account) ? allocateCiAccount(runId, offset, accounts) : '';
    return [{ ...business, account, groups: groups.map(entry => ({ ...entry,
      account: entry.account ? account : '' })) }];
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const matrix = JSON.parse(process.env.IOS_CI_MATRIX);
  const accounts = matrix.include.some(entry => entry.account)
    ? availableCiAccounts(process.env.CLRN_IOS_CI_TEST_ACCOUNTS) : [];
  const bundled = bundleIosMatrix(matrix, process.env.GITHUB_RUN_ID, accounts,
    process.env.IOS_INCLUDE_STAGING === 'true' && matrix.include.length > 0);
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(bundled)}\nrun_native=${bundled.include.length > 0}\n`);
}
