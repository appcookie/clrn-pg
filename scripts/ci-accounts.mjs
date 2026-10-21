import { readFileSync } from 'node:fs';
import animationInventory from '../ios/full/animation-gate-cases.json' with { type: 'json' };

// 这里只维护公开账号名，密码统一保存在 CLRN_IOS_CI_TEST_ACCOUNTS Secret。
export const ciAccounts = JSON.parse(readFileSync(new URL('./ci-test-accounts.json', import.meta.url), 'utf8')).accounts;
if (ciAccounts.length !== 70 || new Set(ciAccounts.map(name => name.toLowerCase())).size !== 70) {
  throw new Error('CI 账号清单必须包含 70 个不同的 iOS 预留账号。');
}

// 三个仓库固定使用互不相交的账号；GitHub concurrency 仅在本仓库生效。
export const executionAccounts = ciAccounts;

/**
 * 按运行 ID 轮转账号槽位；账号级 GitHub concurrency 才负责跨 runner 互斥。
 * 同一次重跑复用相同槽位；共享账号的任务必须由 workflow 串行调度并持有账号锁。
 * @param runId - GitHub Actions 运行 ID，使用字符串以免大整数丢失精度。
 * @param offset - 本轮任务相对起始槽位的偏移。
 * @returns 本任务使用的公开账号名。
 */
export function allocateCiAccount(runId, offset = 0, available = executionAccounts) {
  if (typeof runId !== 'string' || !runId || /\D/.test(runId) || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('CI 账号分配需要有效运行 ID 和账号槽位偏移。');
  }
  if (!Array.isArray(available) || available.length === 0 || new Set(available).size !== available.length
    || available.some(username => !ciAccounts.includes(username))) {
    throw new Error('至少需要一个已配置的独立 iOS 账号');
  }
  return available[Number((BigInt(runId) + BigInt(offset)) % BigInt(available.length))];
}

/**
 * iOS 各业务组只使用预留的独立账号，不能借用 Android/Web 账号。
 * @param runId - 当前 GitHub Actions 运行编号。
 * @param selectedGroup - 全部业务组或一个指定组。
 * @param selectedLocale - 全部语言或一种指定语言。
 */
export function iosAccountMatrix(runId, selectedGroup = 'all', selectedLocale = 'all', available = []) {
  if (selectedGroup === 'animations' || selectedGroup === 'pr') {
    if (!['all', 'en'].includes(selectedLocale)) throw new Error('动画门禁固定使用英文');
    const animationJobs = animationInventory.cases.map((entry, index) => ({
      group: entry.group, locale: 'en', shard: entry.id, animation: entry.id,
      filter: `${entry.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, playwrightShard: '',
      label: `animation / ${entry.id} / ${entry.title}`,
      account: entry.group === 'guest' ? '' : allocateCiAccount(runId, index, available),
    }));
    return { include: [...(selectedGroup === 'pr' ? iosAccountMatrix(runId, 'guest', 'all').include : []),
      ...animationJobs] };
  }
  // 保留业务组的固定槽位，德州、拼三张的全部语言优先进入矩阵。
  const functionalGroups = ['functional', 'functional-creation', 'interaction', 'network'];
  const groups = ['guest', 'account', 'social', 'rooms', 'wallet-help', 'records', 'texas', 'zhajinhua', ...functionalGroups];
  const executionOrder = ['texas', 'zhajinhua', ...groups.filter(group => group !== 'texas' && group !== 'zhajinhua')];
  const locales = ['zh-Hans', 'zh-Hant', 'en'];
  const texasTable = 'signed_in_texas_(?:pre_game|optional_pre_game|game|panels)$';
  const texasOther = 'signed_in_texas_(?:hall|records_v2|controls|table_states|panel_variants|hall_variants)$';
  // 按完整测试文件划分，启动失败不能让 maxFailures 提前截断页面覆盖。
  const guestPages = '(?:^|\\s)tests/parity\\.spec\\.ts(?:\\s|$)';
  const shards = {
    // Playwright 按真实测试分片，不依赖容易漏项的标题正则。
    'functional/en': Array.from({ length: 5 }, (_, index) => [`part-${index + 1}`, '', `${index + 1}/5`]),
    'texas/zh-Hans': [['table', texasTable], ['other', texasOther]],
    'texas/zh-Hant': [['table', texasTable], ['other', texasOther]],
    'texas/en': [
      ['pregame-first', 'signed_in_texas_pre_game_first$'],
      ['pregame-middle', 'signed_in_texas_pre_game_middle$'],
      ['pregame-second', 'signed_in_texas_(?:pre_game_second|optional_pre_game)$'],
      ['game-table', 'signed_in_texas_game_table$'],
      ['game-effects', 'signed_in_texas_game_effects$'],
      ['panels', 'signed_in_texas_(?:panels|panel_variants)$'],
      ['other', 'signed_in_texas_(?:hall|records_v2|controls|table_states|hall_variants)$'],
    ],
    'zhajinhua/en': [
      ['pregame-first', 'signed_in_zhajinhua_pre_game_first$'],
      ['pregame-second', 'signed_in_zhajinhua_pre_game_second$'],
      ['game-table', 'signed_in_zhajinhua_game_table$'],
      ['game-effects', 'signed_in_zhajinhua_game_effects$'],
      ['pregame-middle', 'signed_in_zhajinhua_pre_game_middle$'],
    ],
  };
  const shardOffsets = {
    'texas/zh-Hans': 24, 'texas/zh-Hant': 25, 'texas/en': 26, 'zhajinhua/en': 32,
  };
  if (selectedGroup !== 'all' && !groups.includes(selectedGroup)) throw new Error('未知 iOS业务组。');
  if (selectedLocale !== 'all' && !locales.includes(selectedLocale)) throw new Error('未知 iOS语言。');
  return { include: executionOrder.filter(group => selectedGroup === 'all' || group === selectedGroup)
    .flatMap(group => (functionalGroups.includes(group) ? ['en']
      : (group === 'guest' ? ['en', 'zh-Hans', 'zh-Hant'] : locales)
        .filter(locale => selectedLocale === 'all' || locale === selectedLocale))
      .flatMap(locale => {
        const key = `${group}/${locale}`;
        // English startup has seven cases (~35 min); queue it before the shorter
        // Chinese startup shards so max-parallel does not leave it until last.
        const guestParts = [['pages', guestPages], ['startup', `^(?!.*${guestPages})`]];
        const parts = group === 'guest' ? (locale === 'en' ? guestParts.slice().reverse() : guestParts)
          : shards[key] || [['all', '']];
        return parts.map(([shard, filter, playwrightShard = ''], index) => ({ group, locale, shard, filter, playwrightShard,
          label: `${group} / ${locale}${shard === 'all' ? '' : ` / ${shard}`}`,
          // 原 functional 槽位 35 留给第一片；新片使用 39–42，保留其余组槽位。
          // 新拼三张中组使用43，保留其余功能组及旧分片的独立账号槽位。
          account: group === 'guest' ? '' : allocateCiAccount(runId, group === 'zhajinhua' && shard === 'pregame-middle'
            ? 43 : group === 'functional' && index > 0
            ? 38 + index : functionalGroups.includes(group)
            ? 35 + functionalGroups.indexOf(group) : index === 0
              ? groups.indexOf(group) * 3 + locales.indexOf(locale) : shardOffsets[key] + index - 1, available) }));
      })) };
}

/** 验证最少一个专用 iOS 账号；不强迫预建全部公开预留名。 */
function parseCiAccountPool(serialized) {
  let pool;
  try { pool = JSON.parse(serialized); } catch { throw new Error('CLRN_IOS_CI_TEST_ACCOUNTS Secret 缺失或不是有效 JSON。'); }
  if (!Array.isArray(pool?.accounts) || pool.accounts.length < 1 || pool.accounts.length > ciAccounts.length) {
    throw new Error('CI Secret 必须包含至少一个、最多 70 个已就绪的独立 iOS 账号。');
  }
  const seen = new Set();
  for (const account of pool.accounts) {
    if (!ciAccounts.includes(account?.username) || seen.has(account.username)
      || account.status !== 'ready' || typeof account.password !== 'string'
      || !account.password.trim() || account.password.length > 20 || /[\r\n\0]/.test(account.password)) {
      throw new Error('CI Secret 包含重复、未就绪、非 iOS 专用或无效凭据；请核对账号池备份。');
    }
    seen.add(account.username);
  }
  return pool.accounts;
}

/** 调度只输出验证过的公开用户名，绝不把密码传入矩阵、日志或 Actions output。 */
export function availableCiAccounts(serialized) {
  const names = new Set(parseCiAccountPool(serialized).map(account => account.username));
  return ciAccounts.filter(username => names.has(username));
}

/** 在账号独占 job 内解析所选凭据；错误不包含 Secret 正文。 */
export function ciAccountCredentials(serialized, username) {
  const selected = parseCiAccountPool(serialized).find(account => account.username === username);
  if (!selected) throw new Error('所选账号未配置在本仓库的独立 iOS 账号池中。');
  return { username: selected.username, password: selected.password };
}
