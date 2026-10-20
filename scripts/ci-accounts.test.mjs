import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPlaywright } from './playwright-collection.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ciAccounts, executionAccounts, allocateCiAccount, iosAccountMatrix, ciAccountCredentials, availableCiAccounts } from './ci-accounts.mjs';

test('iOS预留池与Web/Android公开账号分区不重叠且轮转稳定', () => {
  assert.equal(ciAccounts.length, 70);
  assert.ok(ciAccounts.every(name => /^clrnciios\d{3}$/.test(name)));
  assert.equal(new Set(Array.from({ length: 70 }, (_, index) => allocateCiAccount(String(index)))).size, 70);
  assert.equal(allocateCiAccount('90071992547409931'), executionAccounts[Number(90071992547409931n % 70n)]);
  for (const value of ['', '-1', 'a', undefined]) assert.throws(() => allocateCiAccount(value));
});
test('完整iOS池矩阵分配不同账号，guest不需要账号，功能组固定en', () => {
  const { include } = iosAccountMatrix('123', 'all', 'all', ciAccounts);
  assert.ok(include.length >= 24);
  const signedIn = include.filter(item => item.group !== 'guest');
  assert.equal(new Set(signedIn.map(item => item.account)).size, signedIn.length);
  assert.ok(include.filter(item => item.group === 'guest').every(item => item.account === ''));
  for (const group of ['functional', 'functional-creation', 'interaction', 'network']) {
    const entries = include.filter(item => item.group === group);
    assert.equal(entries.length, group === 'functional' ? 5 : 1);
    assert.ok(entries.every(entry => entry.locale === 'en'));
  }
  assert.equal(iosAccountMatrix('1', 'guest', 'en').include.length, 2);
  assert.throws(() => iosAccountMatrix('1', 'unknown'));
  assert.throws(() => iosAccountMatrix('1', 'all', 'unknown'));
});

test('functional五片账号槽位独立稳定，少量账号只复用已配置池，其余功能组保持原槽位', () => {
  const all = iosAccountMatrix('123', 'all', 'all', ciAccounts).include;
  const functional = iosAccountMatrix('123', 'functional', 'en', ciAccounts).include;
  assert.deepEqual(functional, all.filter(entry => entry.group === 'functional'));
  assert.deepEqual(functional.map(entry => entry.playwrightShard), ['1/5', '2/5', '3/5', '4/5', '5/5']);
  assert.deepEqual(functional.map(entry => entry.account), [35, 39, 40, 41, 42].map(offset => allocateCiAccount('123', offset)));
  assert.ok(functional.every(entry => entry.filter === ''));
  assert.ok(all.filter(entry => entry.group !== 'functional').every(entry => entry.playwrightShard === ''));
  for (const [index, group] of ['functional-creation', 'interaction', 'network'].entries()) {
    assert.equal(all.find(entry => entry.group === group).account, allocateCiAccount('123', 36 + index));
  }
  for (const available of [[ciAccounts[0]], [ciAccounts[2], ciAccounts[5]]]) {
    const entries = iosAccountMatrix('123', 'functional', 'en', available).include;
    assert.equal(entries.length, 5);
    assert.ok(entries.every(entry => available.includes(entry.account)));
    assert.deepEqual(entries, iosAccountMatrix('123', 'all', 'all', available).include.filter(entry => entry.group === 'functional'));
  }
  const workflow = readFileSync(new URL('../.github/workflows/ios-full.yml', import.meta.url), 'utf8');
  assert.match(workflow, /group: ios-account-\$\{\{ matrix\.account \|\|/);
  assert.match(workflow, /queue: max/);
  assert.match(workflow, /IOS_PLAYWRIGHT_SHARD: \$\{\{ matrix\.playwrightShard \}\}/);
  assert.match(workflow, /args\+=\(--shard "\$IOS_PLAYWRIGHT_SHARD" --fully-parallel --workers 1\)/);
});

test('真实Playwright收集的53例恰好落入五个均衡分片且无skip或重复', { timeout: 120_000 }, () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  function collect(shard) {
    const args = ['--config', 'ios/full/playwright.config.ts',
      '--list', '--reporter=json', '--grep', '', '--fully-parallel', '--workers', '1'];
    if (shard) args.push('--shard', shard);
    const report = JSON.parse(collectPlaywright(args, {
      cwd: root, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, IOS_GROUP: 'functional', IOS_LOCALE: 'en' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    const titles = [];
    function visit(suite) {
      for (const spec of suite.specs || []) {
        assert.equal(spec.tests.length, 1);
        assert.equal(spec.tests[0].expectedStatus, 'passed', spec.title);
        titles.push(`${spec.file}:${spec.title}`);
      }
      for (const child of suite.suites || []) visit(child);
    }
    for (const suite of report.suites) visit(suite);
    return titles;
  }
  const complete = collect();
  const parts = iosAccountMatrix('123', 'functional', 'en', ciAccounts).include.map(entry => collect(entry.playwrightShard));
  assert.equal(complete.length, 53);
  assert.deepEqual(parts.map(part => part.length).sort((a, b) => a - b), [10, 10, 11, 11, 11]);
  assert.equal(new Set(parts.flat()).size, 53);
  assert.deepEqual(parts.flat().sort(), complete.sort());
});

test('guest每语言18页独立于启动动画，实际25/21/20项跨两片恰好覆盖一次', { timeout: 180_000 }, () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  function collect(locale, filter = '') {
    const report = JSON.parse(collectPlaywright(['--config', 'ios/full/playwright.config.ts',
      '--list', '--reporter=json', '--grep', filter], {
      cwd: root, env: { IOS_GROUP: 'guest', IOS_LOCALE: locale },
    }));
    const specs = [];
    function visit(suite) {
      for (const spec of suite.specs || []) {
        assert.equal(spec.tests.length, 1);
        assert.equal(spec.tests[0].expectedStatus, 'passed', spec.title);
        specs.push(spec);
      }
      for (const child of suite.suites || []) visit(child);
    }
    for (const suite of report.suites) visit(suite);
    return specs;
  }
  for (const [locale, count] of [['en', 25], ['zh-Hans', 21], ['zh-Hant', 20]]) {
    const entries = iosAccountMatrix('123', 'guest', locale).include;
    assert.deepEqual(entries.map(entry => entry.shard).sort(), ['pages', 'startup']);
    assert.ok(entries.every(entry => entry.account === '' && entry.playwrightShard === ''));
    const complete = collect(locale);
    const pages = collect(locale, entries.find(entry => entry.shard === 'pages').filter);
    const startup = collect(locale, entries.find(entry => entry.shard === 'startup').filter);
    assert.equal(complete.length, count);
    assert.equal(pages.length, 18);
    assert.ok(pages.every(spec => spec.file === 'tests/parity.spec.ts'));
    assert.equal(startup.length, count - 18);
    assert.ok(startup.every(spec => spec.file !== 'tests/parity.spec.ts'));
    const keys = specs => specs.map(spec => `${spec.file}:${spec.title}`);
    const combined = keys([...pages, ...startup]);
    assert.equal(new Set(combined).size, count);
    assert.deepEqual(combined.sort(), keys(complete).sort());
  }
  const first = iosAccountMatrix('123', 'guest', 'all').include[0];
  assert.equal(first.locale, 'en');
  assert.equal(first.shard, 'startup');
  const workflow = readFileSync(new URL('../.github/workflows/ios-full.yml', import.meta.url), 'utf8');
  assert.match(workflow, /max-parallel: 5/);
  assert.match(workflow, /github\.run_id, matrix\.group, matrix\.locale, matrix\.shard/);
});
test('凭据接受任意非空ready独立iOS子池，拒绝原仓库账号或损坏Secret且不泄露正文', () => {
  const accounts = ciAccounts.map(username => ({ username, password: 'fake-password', status: 'ready' }));
  assert.deepEqual(ciAccountCredentials(JSON.stringify({ accounts }), ciAccounts[0]), { username: ciAccounts[0], password: 'fake-password' });
  assert.deepEqual(availableCiAccounts(JSON.stringify({ accounts: [accounts[3], accounts[0]] })), [ciAccounts[0], ciAccounts[3]]);
  assert.deepEqual(ciAccountCredentials(JSON.stringify({ accounts: [accounts[0]] }), ciAccounts[0]), { username: ciAccounts[0], password: 'fake-password' });
  assert.throws(() => ciAccountCredentials(JSON.stringify({ accounts: [accounts[0]] }), ciAccounts[1]));
  for (const pool of [{ accounts: [] }, { accounts: [accounts[0], accounts[0]] }, { accounts: accounts.map((a, i) => i ? a : { ...a, username: 'clrnci261015001' }) },
    { accounts: accounts.map((a, i) => i ? a : { ...a, status: 'reserved' }) }]) {
    assert.throws(() => ciAccountCredentials(JSON.stringify(pool), ciAccounts[0]), error => !error.message.includes('fake-password'));
  }
});

test('凭据注入只允许iOS仓库且必须声明本账号独占锁', async () => {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'ios-ci-account-test-'));
  const output = join(directory, 'environment');
  const selected = ciAccounts[0];
  const env = { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'appcookie/clrn-pg',
    GITHUB_ENV: output, CLRN_CI_ACCOUNT: selected, CLRN_IOS_ACCOUNT_LOCK: selected,
    CLRN_IOS_CI_TEST_ACCOUNTS: JSON.stringify({ accounts: ciAccounts.map(username => ({ username,
      password: 'fake-test-password', status: 'ready' })) }), TESTING_API_TOKEN: 'offline-test-token' };
  const run = override => spawnSync(process.execPath, ['--import', './scripts/account-network-fixture.mjs',
    'scripts/configure-ci-account.mjs'], { env: { ...env, ...override }, encoding: 'utf8' });
  try {
    for (const override of [{ GITHUB_REPOSITORY: 'albitsj/clrn-az' }, { GITHUB_REPOSITORY: 'other/repo' },
      { CLRN_IOS_ACCOUNT_LOCK: '' }, { CLRN_IOS_ACCOUNT_LOCK: ciAccounts[1] }]) {
      writeFileSync(output, '');
      const result = run(override);
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(output, 'utf8'), '');
      assert.ok(!result.stderr.includes('fake-test-password'));
    }
    writeFileSync(output, '');
    const result = run({});
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(output, 'utf8').includes(`VISUAL_USERNAME=${selected}`));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('单账号可覆盖所有非guest矩阵任务，少量账号轮转不引用未配置槽位', () => {
  for (const available of [[ciAccounts[0]], [ciAccounts[2], ciAccounts[5]]]) {
    const { include } = iosAccountMatrix('90071992547409931', 'all', 'all', available);
    assert.ok(include.length >= 39);
    assert.ok(include.every(item => item.group === 'guest' ? item.account === '' : available.includes(item.account)));
  }
  assert.throws(() => iosAccountMatrix('1', 'account', 'en', []), /至少需要一个/);
  assert.equal(iosAccountMatrix('1', 'guest', 'all', []).include.length, 6);
});

test('plan从Secret仅导出公开username，guest无Secret仍可调度', async () => {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'ios-ci-plan-test-'));
  const output = join(directory, 'output');
  const password = 'fake-plan-password';
  const env = { ...process.env, GITHUB_RUN_ID: '123', GITHUB_OUTPUT: output,
    CI_IOS_GROUP: 'all', CI_IOS_LOCALE: 'all', CLRN_IOS_CI_TEST_ACCOUNTS: JSON.stringify({ accounts: [
      { username: ciAccounts[0], password, status: 'ready' }] }) };
  const run = override => spawnSync(process.execPath, ['scripts/plan-ci-accounts.mjs', 'ios'],
    { env: { ...env, ...override }, encoding: 'utf8' });
  try {
    writeFileSync(output, '');
    const planned = run({});
    assert.equal(planned.status, 0, planned.stderr);
    const content = readFileSync(output, 'utf8');
    assert.ok(![content, planned.stdout, planned.stderr].some(value => value.includes(password)));
    const { include } = JSON.parse(content.slice('matrix='.length));
    assert.ok(include.every(item => !item.account || item.account === ciAccounts[0]));
    writeFileSync(output, '');
    const guest = run({ CI_IOS_GROUP: 'guest', CLRN_IOS_CI_TEST_ACCOUNTS: undefined });
    assert.equal(guest.status, 0, guest.stderr);
    assert.ok(JSON.parse(readFileSync(output, 'utf8').slice('matrix='.length)).include.every(item => item.account === ''));
    writeFileSync(output, '');
    const invalid = run({ CLRN_IOS_CI_TEST_ACCOUNTS: password });
    assert.notEqual(invalid.status, 0);
    assert.equal(readFileSync(output, 'utf8'), '');
    assert.ok(!invalid.stderr.includes(password));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
